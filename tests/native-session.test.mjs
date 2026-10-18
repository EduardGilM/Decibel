import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { api, serverBase } from '../src/lib/profile/api.ts'
import { artworkSessionHeaders, saveSessionToken, sessionHeaders } from '../src/lib/profile/session-token.ts'
import { YtDlpProvider } from '../src/lib/providers/ytdlp.ts'
import { createApp } from '../server/index.mjs'
import { createProfileApi } from '../server/profile-api.mjs'

function client(t, base, origin = 'http://tauri.localhost') {
  const previous = globalThis.window, storage = new Map([['decibel-server-url', base]])
  globalThis.window = { location: { origin }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) }, dispatchEvent: () => {} }
  t.after(() => { globalThis.window = previous })
  return storage
}

test('native login authorizes yt-dlp and profile APIs without any cookie jar, then logout removes the token', async t => {
  const profiles = await createProfileApi({ seed: false })
  await profiles.accounts.createUser({ username: 'Native Test', password: 'native-test-password' })
  const track = { id: 'yt:aaaaaaaaaaa' }
  const music = { search: async () => ({ tracks:[track],albums:[],artists:[] }), prepare: async () => ({ok:true}), stream:async()=>({url:'https://audio.test/stream',track}) }
  const app = await createApp({music,profiles,allowedOrigins:['http://tauri.localhost']})
  app.listen(0,'127.0.0.1');await once(app,'listening')
  t.after(async()=>{await new Promise(r=>{app.close(r);app.closeAllConnections()});profiles.db.close()})
  const base=`http://127.0.0.1:${app.address().port}`
  const storage=client(t,base), requests=[]
  const nativeFetch=globalThis.fetch
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    const headers=new Headers(init.headers);headers.set('Origin','http://tauri.localhost')
    requests.push({path:new URL(url).pathname,authorization:headers.get('authorization'),cookie:headers.get('cookie')})
    return nativeFetch(url,{...init,headers})
  })
  await api('/api/auth/login',{method:'POST',body:{username:'Native Test',password:'native-test-password'}})
  assert.ok(storage.get('decibel-session-tokens'))
  assert.equal((await api('/api/auth/me')).user.name,'Native Test')
  const provider=new YtDlpProvider()
  assert.equal((await provider.search('test')).tracks.length,1)
  await provider.prepareTrack(track)
  assert.equal(await provider.streamUrl(track),'https://audio.test/stream')
  assert.ok(requests.slice(1).every(r=>r.authorization?.startsWith('Bearer ')))
  assert.ok(requests.every(r=>r.cookie===null))
  await api('/api/auth/logout',{method:'POST'})
  assert.deepEqual(sessionHeaders(base),{})
  await assert.rejects(api('/api/auth/me'),{status:401})
})

test('tokens follow server and base-path boundaries and are read fresh on every request',async t=>{
  client(t,'https://music.test/decibel')
  saveSessionToken(serverBase(),'test-session-one')
  const requests=[]
  t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,headers:new Headers(init.headers),credentials:init.credentials});return Response.json({tracks:[],albums:[],artists:[]})})
  const provider=new YtDlpProvider()
  await provider.search('one')
  saveSessionToken(serverBase(),'test-session-two')
  await provider.search('two')
  await new YtDlpProvider('https://other.test').search('other')
  await new YtDlpProvider('https://music.test/another').search('another')
  assert.equal(requests[0].headers.get('authorization'),'Bearer test-session-one')
  assert.equal(requests[1].headers.get('authorization'),'Bearer test-session-two')
  assert.equal(requests[2].headers.get('authorization'),null)
  assert.equal(requests[3].headers.get('authorization'),null)
  assert.ok(requests.every(r=>r.credentials==='include'))
  assert.deepEqual(artworkSessionHeaders('https://music.test/decibel/api/music/artwork?url=cover'),{Authorization:'Bearer test-session-two'})
  assert.deepEqual(artworkSessionHeaders('https://i.ytimg.com/vi/video/art.jpg'),{})
  assert.deepEqual(artworkSessionHeaders('https://other.test/api/music/artwork'),{})
})

test('same-origin web login keeps its HttpOnly cookie session without persisting a Bearer token',async t=>{
  const storage=client(t,'https://music.test','https://music.test')
  t.mock.method(globalThis,'fetch',async()=>Response.json({user:{id:'web'},token:'test-web-cookie-session'}))
  await api('/api/auth/login',{method:'POST',body:{username:'web',password:'test'}})
  assert.deepEqual(sessionHeaders('https://music.test'),{})
  assert.ok(!storage.get('decibel-session-tokens')?.includes('test-web-cookie-session'))
})

test('an old unauthorized response cannot erase the token from a newer login',async t=>{
  client(t,'https://music.test')
  saveSessionToken('https://music.test','test-old-session')
  let finishOld
  t.mock.method(globalThis,'fetch',async url=>url.endsWith('/login')?Response.json({user:{id:'new'},token:'test-new-session'}):new Promise(resolve=>{finishOld=resolve}))
  const previous=api('/api/auth/me')
  await api('/api/auth/login',{method:'POST',body:{username:'new',password:'test'}})
  finishOld(Response.json({error:'expired'},{status:401}))
  await assert.rejects(previous,{status:401})
  assert.deepEqual(sessionHeaders('https://music.test'),{Authorization:'Bearer test-new-session'})
})
