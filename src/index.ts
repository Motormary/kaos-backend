import { createClient } from '@supabase/supabase-js'
import express from 'express'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'

//todo: Add supabase - Connect user etc

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const PORT = 8000

let clients = new Map() // Store clients with unique IDs

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
  //? Get connecting users username/id and save it to memory with new socket
  const params = new URLSearchParams(req.url.split('?')[1])
  const remoteClient = params.get("user")
  console.log(
    'Clients:',
    Array.from(clients).map((value) => value[0])
  )
  // let remoteClient: string
  // let collab_id: string
  /*   if (clients.size) {
    ws.send(
      JSON.stringify({
        remoteClient,
        message: {
          type: 'connected',
          currentUsers: Array.from(clients.keys()),
        },
      })
    )
  }
  
  console.log(`New client connected: ${remoteClient}`) */

  console.log(remoteClient, "connected")
  clients.set(remoteClient, ws)
  
  ws.on('message', async (message) => {
    const parsedMsg = JSON.parse(message.toString())
    // console.log("🚀 ~ ws.on ~ parsedMsg:", parsedMsg)
    if (parsedMsg?.type === 'connect') {
      // todo: check connection time etc, avoid permanent connection
      const collab_id = parsedMsg.connect.collab_id
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(parsedMsg.connect.token)
      if (error) {
        ws.terminate()
        throw new Error('Authentication error', error)
      }
      const supaclient = await createSupa(parsedMsg.connect.token)

      const { error: userError } = await supaclient
        .from('collab_users')
        .update({ connection_status: 'connected' })
        .match({ collab_id: collab_id, user_id: user.id })

      if (userError) {
        throw new Error('Error connecting user to collab', userError)
      }

      return
    }

    if (parsedMsg?.type === 'disconnect') {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(parsedMsg.disconnect.token)

      if (error) {
        throw new Error('Authentication error', error)
      }

      const supaclient = await createSupa(parsedMsg.disconnect.token)
      const { error: userError } = await supaclient
        .from('collab_users')
        .update({ connection_status: 'disconnected' })
        .match({ collab_id: parsedMsg.connect.collab_id, user_id: user.id })

      if (userError) {
        throw new Error('Error disconnecting client:', userError)
      }
    }

    if (message) {
      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          //? Pass socket owner along with message
          client.send(
            `{"remoteClient":"${remoteClient}","message":${message.toString()}}`
          )
        }
      })
    }
  })

  ws.on('error', (error) => {
    console.error('error:', error)
  })

  ws.on('close', async () => {
    /*   clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        //? Pass socket owner along with message
           const msg = {
          remoteClient: remoteClient,
          message: {
            type: 'disconnect',
            disconnect: {
              user: remoteClient,
            },
          },
        }
        client.send(JSON.stringify(msg)) 
      }
    }) */
    clients.delete(ws) //? Remove current client from memory
    console.log(remoteClient, "disconnected")
  })
})

app.get('/', (req, res) => {
  res.send('<p>These are not the routes you are looking for</p>')
})

server.listen(PORT, () => {
  console.log(`Server is listening on http://192.168.10.132:${PORT}`)
})
