import { createClient } from '@supabase/supabase-js'
import express from 'express'
import http from 'http'
import { WebSocket, WebSocketServer } from 'ws'

//todo: Add supabase - Connect user etc

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const PORT = 8000

let clients: Map<string, Map<string, WebSocket>> = new Map()
// map<CHANNEL/COLLAB_ID>, map<USERID, WEBSOCKET>>

function isChannel(channel: string) {
  return clients.has(channel)
}

function isUserInChannel(channel: string, user: string) {
  return clients[channel]?.has(user) ?? false
}

function joinChannel(channel: string, user: string, ws: WebSocket) {
  if (!isUserInChannel(channel, user)) {
    if (!clients.has(channel)) {
      clients.set(channel, new Map())
    }

    clients.get(channel).set(user, ws)
  }
}

function leaveChannel(channel: string, user: string) {
  if (!isChannel(channel)) return
  const users = clients[channel]

  if (users?.size === 1 && isUserInChannel(channel, user)) {
    users[user].close()
    return clients.delete(channel)
  }

  if (isUserInChannel(channel, user)) {
    users[user].close()
    return users.delete(user)
  }
}

app.use(express.static('public'))

async function createSupa(token: string) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.split('?')[1])
  const user = params.get('user')
  const channel = params.get('channel')
  if (!user || !channel) {
    console.error('Params missing, user:', user, 'channel:', channel)
    ws.close()
  }

  console.log(clients[channel])

  ws.on('message', async (message) => {
    const parsedMsg = JSON.parse(message.toString())

    //? Connect user and add to channel
    if (parsedMsg?.type === 'connect') {
      console.log(user, 'connected')
      joinChannel(channel, user, ws)
      // todo: check connection time etc, avoid permanent connection
      const { data, error } = await supabase.auth.getUser(
        parsedMsg.connect.token
      )
      if (error) {
        ws.close()
        throw new Error('Authentication error', error)
      }
      const supaclient = await createSupa(parsedMsg.connect.token)

      const { error: userError } = await supaclient
        .from('collab_users')
        .update({ connection_status: 'connected' })
        .match({ collab_id: channel, user_id: data.user.id })

      if (userError) {
        throw new Error('Error connecting user to collab', userError)
      }

      //? Notify user that they've been connected
      ws.send(
        JSON.stringify({
          message: {
            type: 'connected',
          },
        })
      )

      // Tell everyone the user connected to the channel
      const users = clients.get(channel)
      const msg = { remoteClient: user, message: { type: 'connect' } }
      if (users) {
        users.forEach((client: WebSocket) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg))
          }
        })
      }

      return
    }

    if (parsedMsg?.type === 'disconnect') {
      const { data, error } = await supabase.auth.getUser(
        parsedMsg.disconnect.token
      )

      if (error) {
        throw new Error('Authentication error', error)
      }

      const supaclient = await createSupa(parsedMsg.disconnect.token)
      const { error: userError } = await supaclient
        .from('collab_users')
        .update({ connection_status: 'disconnected' })
        .match({ collab_id: channel, user_id: data.user.id })

      if (userError) {
        throw new Error('Error disconnecting client:', userError)
      }

      // Tell everyone the user disconnected from the channel
      const users = clients.get(channel)
      const msg = { remoteClient: user, message: { type: 'disconnect' } }
      if (users) {
        users.forEach((client: WebSocket) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg))
          }
        })
      }

      return
    }

    if (message && isChannel(channel)) {
      const users = clients.get(channel)
      if (users) {
        users.forEach((client: WebSocket) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(
              `{"remoteClient":"${user}","message":${message.toString()}}`
            )
          }
        })
      }
    }
  })

  ws.on('error', (error) => {
    console.error('error:', error)
  })

  ws.on('close', () => {
    leaveChannel(channel, user)
    console.log(user, 'disconnected')
  })
})

app.get('/', (req, res) => {
  res.send('<p>These are not the routes you are looking for</p>')
})

server.listen(PORT, () => {
  console.log(`Server is listening on http://192.168.10.132:${PORT}`)
})
