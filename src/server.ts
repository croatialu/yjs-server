import http from 'node:http'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import type WebSocket from 'ws'
import { WebSocketServer } from 'ws'
import * as map from 'lib0/map'

interface MessageItem {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'ping' | 'pong'
  topics?: string[]
  topic?: string
  clients?: number
}

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
// const wsReadyStateClosing = 2
// const wsReadyStateClosed = 3

const pingTimeout = 30000

const port = process.env.PORT || 4444
const wss = new WebSocketServer({ noServer: true })

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

/**
 * Map froms topic-name to set of subscribed clients.
 */
const topics = new Map<string, Set<any>>()

/**
 * @param {any} conn
 * @param {object} message
 */
function send(conn: WebSocket, message: MessageItem) {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen)
    conn.close()

  try {
    conn.send(JSON.stringify(message))
  }
  catch (e) {
    conn.close()
  }
}

/**
 * Setup a new client
 */
function onconnection(conn: WebSocket) {
  const subscribedTopics = new Set<string>()
  let closed = false
  // Check if connection is still alive
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close()
      clearInterval(pingInterval)
    }
    else {
      pongReceived = false
      try {
        conn.ping()
      }
      catch (e) {
        conn.close()
      }
    }
  }, pingTimeout)
  conn.on('pong', () => {
    pongReceived = true
  })
  conn.on('close', () => {
    subscribedTopics.forEach((topicName) => {
      const subs = topics.get(topicName) || new Set()
      subs.delete(conn)
      if (subs.size === 0)
        topics.delete(topicName)
    })
    subscribedTopics.clear()
    closed = true
  })
  conn.on('message', (messageStr) => {
    let message: MessageItem | undefined
    if (typeof messageStr === 'string' || messageStr instanceof Buffer)
      message = JSON.parse(messageStr as any)

    // eslint-disable-next-line no-console
    console.log(`【${new Date().toISOString()}】onMessage: `, message)
    if (message && message.type && !closed) {
      switch (message.type) {
        case 'subscribe':
          (message.topics || []).forEach((topicName) => {
            if (typeof topicName === 'string') {
            // add conn to topic
              const topic = map.setIfUndefined(topics, topicName, () => new Set())
              topic.add(conn)
              // add topic to conn
              subscribedTopics.add(topicName)
            }
          })
          break
        case 'unsubscribe':
          (message.topics || []).forEach((topicName) => {
            const subs = topics.get(topicName)
            if (subs)
              subs.delete(conn)
          })
          break
        case 'publish':
          if (message.topic) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              message.clients = receivers.size
              receivers.forEach(receiver =>
                send(receiver, message!),
              )
            }
          }
          break
        case 'ping':
          send(conn, { type: 'pong' })
      }
    }
  })
}
wss.on('connection', onconnection)

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  /**
   * @param {any} ws
   */
  const handleAuth = (ws: WebSocket) => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

// eslint-disable-next-line no-console
console.log('Signaling server running on localhost:', port)
