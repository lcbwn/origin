const config = require('../config')
const get = require('lodash/get')

const Web3 = require('web3')
const bodyParser = require('body-parser')
const Stripe = require('stripe')

const { authenticated } = require('./_combinedAuth')
const { ListingID } = require('../utils/id')
const { shopGate } = require('../utils/gates')
const encConf = require('../utils/encryptedConfig')
const { post, getBytes32FromIpfsHash } = require('../utils/_ipfs')
const abi = require('../utils/_abi')
const { WEB3_PK, PROVIDER } = require('../utils/const')

const ZeroAddress = '0x0000000000000000000000000000000000000000'

// TODO: This needs to be cleaner, all of this conf does
const web3 = new Web3(PROVIDER)
let walletAddress
if (WEB3_PK) {
  const account = web3.eth.accounts.wallet.add(WEB3_PK)
  walletAddress = account.address
  console.log(`using walletAddress ${walletAddress}`)
} else {
  throw new Error('WEB3_PK must be defined')
}

const rawJson = bodyParser.raw({ type: 'application/json' })

module.exports = function(app) {
  app.post('/pay', authenticated, shopGate, async (req, res) => {
    const { shopId } = req

    if (req.body.amount < 50) {
      return res.status(400).send({
        success: false,
        message: 'Amount too low for credit card payment'
      })
    }

    // Get API Key from config, and init Stripe
    const stripeBackend = await encConf.get(shopId, 'stripeBackend')
    const stripe = Stripe(stripeBackend || '')

    console.log('Trying to make payment...')
    const paymentIntent = await stripe.paymentIntents.create({
      amount: req.body.amount,
      currency: 'usd',
      metadata: {
        shopId,
        encryptedData: req.body.data
      }
    })

    // console.log(paymentIntent)

    res.send({ success: true, client_secret: paymentIntent.client_secret })
  })

  // Stripe CLI for testing webhook:
  //    stripe listen --forward-to localhost:3000/webhook
  //    STRIPE_WEBHOOK_SECRET=xxx node backend/payment.js
  //    stripe trigger payment_intent.succeeded

  app.post('/webhook', rawJson, async (req, res) => {
    // Need to get the shopId before the stripe library processes the incoming
    // buffer
    let jasonBody, shopId
    try {
      jasonBody = JSON.parse(req.body.toString())
      shopId = get(jasonBody, 'data.object.metadata.shopId')
    } catch (err) {
      console.error('Error parsing body: ', err)
      return res.sendStatus(400)
    }

    // TODO: use a validator instead
    if (!shopId) {
      console.debug('Missing shopId from /webhook request')
      return res.sendStatus(400)
    }

    // Get API Key from config, and init Stripe
    const stripeBackend = await encConf.get(shopId, 'stripeBackend')
    const dataURL = await encConf.get(shopId, 'dataUrl')

    const stripe = Stripe(stripeBackend || '')

    const webhookSecret = await encConf.get(shopId, 'stripeWebhookSecret')
    const siteConfig = await config.getSiteConfig(dataURL)
    const lid = ListingID.fromFQLID(siteConfig.listingId)
    let event
    const signature = req.headers['stripe-signature']
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`)
      console.error(err)
      return res.sendStatus(400)
    }

    if (event.type !== 'payment_intent.succeeded') {
      console.log(`Ignoring event ${event.type}`)
      return res.sendStatus(200)
    }

    console.log(JSON.stringify(event, null, 4))

    const encryptedData = get(event, 'data.object.metadata.encryptedData')
    const contractAddr = lid.address()

    if (!contractAddr) {
      console.error(
        'Contract missing address.  Will be unable to send transaction.'
      )
      return res.status(500)
    }

    const offer = {
      schemaId: 'https://schema.originprotocol.com/offer_2.0.0.json',
      listingId: lid.toString(),
      listingType: 'unit',
      unitsPurchased: 1,
      totalPrice: {
        amount: get(event, 'data.object.amount') / 100,
        currency: 'fiat-USD'
      },
      commission: { currency: 'OGN', amount: '0' },
      finalizes: 60 * 60 * 24 * 14, // 2 weeks after offer accepted
      encryptedData
    }

    let ires
    try {
      ires = await post(siteConfig.ipfsApi, offer, true)
    } catch (err) {
      console.error(`Error adding offer to ${siteConfig.ipfsApi}!`)
      console.error(err)
      return res.status(500)
    }
    const Marketplace = new web3.eth.Contract(abi, contractAddr)

    Marketplace.methods
      .makeOffer(
        lid.listingId,
        getBytes32FromIpfsHash(ires),
        offer.finalizes,
        siteConfig.affiliate || ZeroAddress,
        '0',
        '0',
        ZeroAddress,
        siteConfig.arbitrator || walletAddress
      )
      .send({
        from: walletAddress,
        gas: 350000
      })
      .then(tx => {
        console.log('Make offer:')
        console.log(tx)
      })
      .catch(err => {
        console.log(err)
      })

    res.sendStatus(200)
  })
}
