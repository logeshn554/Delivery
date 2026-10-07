import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../packages/api-client/index.js';
import {activeStatuses,services,transitions,registrationRoles} from '../packages/constants/index.js';

test('shared service engine and public account roles', () => {
  assert.equal(services.length,5);
  assert.equal(registrationRoles.includes('admin'),false);
  assert.deepEqual(transitions.requested,['cancelled']);
  assert.equal(activeStatuses.includes('completed'),false);
});
test('versioned API client preserves native credentials and request idempotency',async () => {
  let observed;
  const client = createApiClient({baseUrl:'https://goserve.example/',getToken:async ()=>'session',fetchImpl:async (url,options)=>{
    observed={url,options};return Response.json({order:{id:'GS-example'}},{status:201});
  }});
  assert.equal((await client('/orders',{method:'POST',body:{requestId:'stable-id'}})).order.id,'GS-example');
  assert.equal(observed.url,'https://goserve.example/api/v1/orders');
  assert.equal(observed.options.headers.Authorization,'Bearer session');
  assert.equal(JSON.parse(observed.options.body).requestId,'stable-id');
  await assert.rejects(client('//external.example'),/relative path/);
});
test('API errors retain their status and safe server message',async () => {
  const client=createApiClient({baseUrl:'https://goserve.example',fetchImpl:async()=>Response.json({error:'Please sign in.'},{status:401})});
  await assert.rejects(client('/me'),error=>error.status===401&&error.message==='Please sign in.');
});
