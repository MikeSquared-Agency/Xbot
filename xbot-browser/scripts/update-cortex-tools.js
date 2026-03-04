#!/usr/bin/env node
'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')

const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '../seeds/tools.json'), 'utf8'))
const indexPath = path.join(__dirname, '../data/cortex/tool-index.json')
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))

async function patch(toolName, domain) {
  const tool = seeds.tools.find(t => t.name === toolName)
  const id = index['tool:' + domain + ':' + toolName]
  if (!tool) { console.error('Tool not found in seeds:', toolName); return Promise.resolve() }
  if (!id) { console.error('Tool not found in index:', toolName); return Promise.resolve() }

  // Cortex stores tool data in the body field as a JSON string
  // We need to fetch the current body, merge in updates, and PATCH the full body
  const currentNode = await new Promise((resolve, reject) => {
    http.get('http://localhost:9091/nodes/' + id, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(JSON.parse(d).data))
    }).on('error', reject)
  })
  let currentBody = currentNode.body
  if (typeof currentBody === 'string') currentBody = JSON.parse(currentBody)
  currentBody.execution = tool.execution
  currentBody.description = tool.description
  const body = JSON.stringify({ body: JSON.stringify(currentBody) })

  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:9091/nodes/' + id + '?gate=skip', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-gate-override': 'true' }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { console.error(toolName + ':', d); resolve() })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const tools = process.argv.slice(2)
if (tools.length === 0) {
  console.error('Usage: node update-cortex-tools.js <toolName> [toolName...]')
  console.error('Example: node update-cortex-tools.js x:get-list-feed x:search-tweets')
  process.exit(1)
}

;(async () => {
  for (const name of tools) {
    const tool = seeds.tools.find(t => t.name === name)
    const domain = tool ? tool.domain : 'x.com'
    await patch(name, domain)
  }
})()
