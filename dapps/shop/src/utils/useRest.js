import { useEffect, useState } from 'react'
import useConfig from 'utils/useConfig'

const { BACKEND_AUTH_TOKEN } = process.env

function useRest(url, opts = {}) {
  const { config } = useConfig()
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchData(url) {
      setLoading(true)
      try {
        const headers = new Headers({
          authorization: `bearer ${BACKEND_AUTH_TOKEN}`
        })
        const myRequest = new Request(`${config.backend}${url}`, {
          credentials: 'include',
          headers
        })
        const raw = await fetch(myRequest)
        const res = await raw.json()
        setData({ ...data, [url]: res })
        setLoading(false)
      } catch (e) {
        setLoading(false)
        setError(true)
      }
    }
    if (data[url] === undefined && !opts.skip) {
      fetchData(url)
    }
  }, [url])

  return { data: data[url], loading, error }
}

export default useRest
