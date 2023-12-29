import net from 'net'
import jimp from 'jimp'
import _ from 'lodash'
import ProgressBar from 'progress'

let connections
let activeConnections = new Set()
let count = 0
let allConnectionsDone = true

const replaceConn = (conn) => {
  connections.splice(connections.indexOf(conn), 1, getConn(replaceConn)).pop().destroy()
}

function getConn() {
  const options = {
    host: 'IP',
    port: 1337
  }

  let isConnected = false

  const client = net.createConnection(options, function () {
    isConnected = true
    count += 1
    bar.tick(1)
    bar.interrupt(`Connection established. port: ${client.localPort} Current count:${count}`)
  })

  client.setTimeout(1000)
  client.setEncoding('utf8')

  client.on('data', function (data) {
    bar.interrupt('Server return data : ' + data)
  })

  client.on('end', function () {
    if (isConnected) {
      count -= 1
      bar.tick(-1)
      bar.interrupt('Connection ended. Current count:'+count)
    }
  })

  client.on('timeout', function () {
    if (isConnected) {
      count -= 1
      bar.tick(-1)
      bar.interrupt('Connection timeout. Current count:'+count)
    }
    replaceConn(client)
  })

  client.on('error', function (err) {
    if (isConnected) {
      bar.interrupt(`Connection error. ${err.toString().substring(0, 20)} Current count: ${count}`)
      count -=1
      bar.tick(-1)
    }
    replaceConn(client)
  })

  return client
}

const TOTAL_FRAMES = 12
const CONNECTIONS_COUNT = 600
const SIZE = [1280, 768]
const FRAME_RATE = 6
const FRAME_DURATION = 1000 / FRAME_RATE
let lastFrameTime = 0;

const bar = new ProgressBar(`[:bar]:current/${CONNECTIONS_COUNT} :elapseds :rate`, { total: CONNECTIONS_COUNT+1, renderThrottle: 10 });

const offset = { x: 0, y: 0 }

;(async () => {
  const images = (await Promise.all(_.range(TOTAL_FRAMES)
    .map(async i => await jimp.read(`./frames/${i.toString().padStart(3,'0')}.png`))
  ))
  .map(i => i.scale(.8))

  const {width, height} = images[0].bitmap

  connections = _.range(CONNECTIONS_COUNT).map(i => getConn(replaceConn))
  const nextConn = () => {
    connections.unshift(connections.pop())
    const conn = connections[0]
    activeConnections.add(conn)
    allConnectionsDone = false
    return conn
  }

  const cmd = images.map(image => _
    .chain(_.range(width))
    .map(x => _
      .range(height)
      .filter(y =>
        !_.endsWith(image.getPixelColor(x, y).toString(16).padStart(8, 'f'), '00') &&
        // image.getPixelColor(x, y).toString(16).padStart(8, '0') != '013368ff' &&
        x <= SIZE[0] &&
        y <= SIZE[1] &&
        // x > 100 &&
        1
      )
      .map(y => image.getPixelColor(x, y).toString(16).padStart(8, '0').substring(0, 6))
      .map((color, y) => `PX ${x+offset.x} ${y+offset.y} ${color}\n`)
    )
    .flatten()
    .shuffle()
    .chunk(CONNECTIONS_COUNT/FRAME_RATE)
    .map(c => c.join(''))
    .value()
  )

  const nextCmd = () => (cmd.unshift(cmd.pop()), cmd[0])
  let currCmd = nextCmd()

  const renderFrame = () => {
    const now = performance.now()
    const timeSinceLastFrame = now - lastFrameTime

    if (timeSinceLastFrame >= FRAME_DURATION) {
      if (allConnectionsDone) {
        currCmd = nextCmd()
        lastFrameTime = now
      } else {
        setTimeout(renderFrame, 1)
        return
      }
    }

    currCmd.forEach(chunk => {
      const conn = nextConn()

      conn.write(chunk, () => {
        activeConnections.delete(conn)
        if (activeConnections.size === 0) {
          allConnectionsDone = true
        }
      })
    })

    const timeToNextFrame = FRAME_DURATION - (performance.now() - now)
    setTimeout(renderFrame, timeToNextFrame)
  }

  renderFrame()
})()
