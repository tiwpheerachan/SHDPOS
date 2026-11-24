// Run as a managed service beside Next.js in production. No credentials are printed.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const key=process.env.OW_SYNC_CRON_SECRET;
if(!key||key.length<32)throw Error('OW_SYNC_CRON_SECRET is required');
const base=process.env.OW_SYNC_WORKER_ORIGIN||'http://localhost:3100';
const url=new URL('/api/internal/ow-sync',base);
const outbox=new URL('/api/internal/ow-outbox',base); // ส่งบิลขายแยกจากรอบอ่านแคตตาล็อก
if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Worker requires HTTPS outside localhost');
let stop=false;process.on('SIGTERM',()=>stop=true);process.on('SIGINT',()=>stop=true);
do{
 try{const o=await fetch(outbox,{method:'POST',headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(110000),redirect:'error'});const oj=await o.json().catch(()=>({}));if(!o.ok)console.error(JSON.stringify({at:new Date().toISOString(),outbox_error:oj.error||o.status}));else if((oj.sales||[]).length||oj.followup?.changed)console.log(JSON.stringify({at:new Date().toISOString(),sales:oj.sales,followup:oj.followup}));}catch(error){console.error(JSON.stringify({at:new Date().toISOString(),outbox_error:error.message}));}
 try{const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(250000),redirect:'error'});const result=await response.json();if(!response.ok)throw Error(result.error||'sync failed');if(!result.skipped)console.log(JSON.stringify({at:new Date().toISOString(),summary:result.summary}));}
 catch(error){console.error(JSON.stringify({at:new Date().toISOString(),error:error.message}));}
 if(!stop&&!process.argv.includes('--once'))await new Promise(resolve=>setTimeout(resolve,10000));
}while(!stop&&!process.argv.includes('--once'));
