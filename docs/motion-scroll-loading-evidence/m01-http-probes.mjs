import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const results=[];
async function run(scenario, check) {
  const probe=createServer();
  await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port;
  await new Promise(r=>probe.close(r));
  const child=spawn(process.execPath,['D:/yaskapp/scripts/t02-motion-scroll-baseline-server.mjs'],{cwd:'D:/yaskapp',env:{...process.env,T02_HOST:'127.0.0.1',T02_PORT:String(port),T02_SCENARIO:scenario,T02_MEDIA_DELAY_MS:'0'},stdio:'ignore'});
  const origin='http://127.0.0.1:'+port;
  try {
    for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    results.push({scenario,...await check(origin)});
  } finally {if(child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}}
}
await run('normal',async origin=>{
 const feed=await (await fetch(origin+'/polls')).json();assert.equal(feed.items.length,4);
 const image=await fetch(origin+'/media/landscape-16x9.svg');const missing=await fetch(origin+'/media/missing.svg');assert.equal(image.status,200);assert.equal(missing.status,404);
 return {polls:4,image:image.status,missing:missing.status};
});
await run('delay',async origin=>{const start=performance.now();const response=await fetch(origin+'/polls');const ms=performance.now()-start;assert.equal(response.status,200);assert(ms>=1900);return{status:response.status,elapsedMs:ms};});
await run('error',async origin=>{const first=await fetch(origin+'/polls');const retry=await fetch(origin+'/polls');assert.equal(first.status,503);assert.equal(retry.status,200);return{initial:first.status,retry:retry.status,polls:(await retry.json()).items.length};});
await run('reorder',async origin=>{
 const order=['vote-start'];
 const vote=fetch(origin+'/polls/motion-long-text/votes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({optionId:'motion-long-text-option-a'})}).then(async r=>{order.push('vote-finish');return (await r.json()).poll;});
 await new Promise(r=>setTimeout(r,30));
 const like=await (await fetch(origin+'/polls/motion-long-text/likes',{method:'POST'})).json();order.push('like-finish');
 const staleVote=await vote;
 assert.deepEqual(order,['vote-start','like-finish','vote-finish']);assert.equal(like.poll.viewerHasLiked,true);assert.equal(staleVote.viewerHasLiked,false);assert.equal(staleVote.likesCount,9);assert.equal(staleVote.votesCount,10);assert.equal(staleVote.viewerVoteOptionId,"motion-long-text-option-a");
 return {order,like:{likesCount:like.poll.likesCount,viewerHasLiked:like.poll.viewerHasLiked},lateVote:{likesCount:staleVote.likesCount,viewerHasLiked:staleVote.viewerHasLiked,votesCount:staleVote.votesCount,viewerVoteOptionId:staleVote.viewerVoteOptionId},note:'HTTP fixture only, no realtime or client merge'};
});
await run('timeout',async origin=>{const start=performance.now();const response=await fetch(origin+'/polls');const ms=performance.now()-start;assert.equal(response.status,504);assert(ms>=14900);return{status:response.status,elapsedMs:ms};});
console.log(JSON.stringify({date:'2026-10-02',results},null,2));
