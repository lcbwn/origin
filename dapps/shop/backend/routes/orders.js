const get = require('lodash/get')
const fetch = require('node-fetch')

const { authenticatedAsSeller } = require('./_combinedAuth')
const { Shops, Orders } = require('../data/db')
const { shopGate } = require('../utils/gates')
const encConf = require('../utils/encryptedConfig')
const { PRINTFUL_URL } = require('../utils/const')

const PrintfulURL = PRINTFUL_URL

module.exports = function(app) {
  app.get('/orders', authenticatedAsSeller, shopGate, async (req, res) => {
    const orders = await Orders.findAll({
      where: { shopId: req.shopId },
      order: [['createdAt', 'desc']]
    })
    res.json(orders)
  })

  app.get('/orders/:id', authenticatedAsSeller, shopGate, async (req, res) => {
    const order = await Orders.findOne({
      where: {
        orderId: req.params.id,
        shopId: req.shopId
      }
    })
    res.json(order)
  })

  app.get('/orders/:id/printful', authenticatedAsSeller, async (req, res) => {
    const { id } = req.params

    const order = await Orders.findOne({
      where: {
        orderId: id
      },
      include: [
        {
          model: Shops,
          as: Shops.tableName,
          where: {
            sellerId: req.user.id
          },
          required: true
        }
      ]
    })

    if (!order) {
      return res.json({
        success: false,
        message: 'Order not found'
      })
    }

    const apiKey = await encConf.get(order.shopId, 'printful')
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Missing printful API configuration'
      })
    }
    const apiAuth = Buffer.from(apiKey).toString('base64')

    const result = await fetch(`${PrintfulURL}/orders/@${id}`, {
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${apiAuth}`
      }
    })
    const json = await result.json()
    res.json(get(json, 'result'))
  })

  app.post(
    '/orders/:id/printful/create',
    authenticatedAsSeller,
    async (req, res) => {
      const { id } = req.params

      const order = await Orders.findOne({
        where: {
          orderId: id
        },
        include: [
          {
            model: Shops,
            as: Shops.tableName,
            where: {
              sellerId: req.user.id
            },
            required: true
          }
        ]
      })

      if (!order) {
        return res.json({
          success: false,
          message: 'Order not found'
        })
      }

      const apiKey = await encConf.get(order.shopId, 'printful')
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          message: 'Missing printful API configuration'
        })
      }
      const apiAuth = Buffer.from(apiKey).toString('base64')

      const newOrderResponse = await fetch(`${PrintfulURL}/orders`, {
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${apiAuth}`
        },
        credentials: 'include',
        method: 'POST',
        body: JSON.stringify(req.body)
      })

      const json = await newOrderResponse.json()

      console.log(json)

      if (!newOrderResponse.ok) {
        console.error('Attempt to create Printful order failed!')
        if (json && json.error) console.error(json.error.message)
        return res.status(json.code).json({
          success: false,
          message: json.error.message
        })
      }

      res.json({ success: true })
    }
  )

  app.post(
    '/orders/:id/printful/confirm',
    authenticatedAsSeller,
    async (req, res) => {
      const { id } = req.params

      const order = await Orders.findOne({
        where: {
          orderId: id
        },
        include: [
          {
            model: Shops,
            as: Shops.tableName,
            where: {
              sellerId: req.user.id
            },
            required: true
          }
        ]
      })

      if (!order) {
        return res.json({
          success: false,
          message: 'Order not found'
        })
      }

      const apiKey = await encConf.get(order.shopId, 'printful')
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          message: 'Missing printful API configuration'
        })
      }
      const apiAuth = Buffer.from(apiKey).toString('base64')

      const url = `${PrintfulURL}/orders/@${req.params.id}/confirm`
      const confirmOrderResponse = await fetch(url, {
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${apiAuth}`
        },
        credentials: 'include',
        method: 'POST'
      })
      const json = await confirmOrderResponse.json()
      console.log(json)

      res.json({ success: true })
    }
  )
}
