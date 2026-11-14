// Offline regression tests. No live API keys, gateway requests or production DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
let serial=0;
async function load(path, deps={}) {
  const key=`__regression${serial++}`;
  globalThis[key]=deps;
  const source=stripTypeScriptTypes(await readFile(new URL('../'+path,import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'');
  const prefix=`const {${Object.keys(deps).join(',')}}=globalThis[${JSON.stringify(key)}];\n`;
  return import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\n//# sourceURL=regression-'+serial+'.js').toString('base64'));
}
const fa=await load('src/lib/fa.ts');
const parser=await load('src/lib/chat/parser.ts',fa);
const categories=[{id:'c',name:'کباب',items:[{id:'m',name:'کباب کوبیده',price:1000,isAvailable:true,isDrink:false}]}];
for(const text of ['قیمت کباب کوبیده چنده؟','کباب کوبیده چی داره؟','کباب کوبیده پیشنهاد میدی؟']) {
  assert.deepEqual(parser.deterministicParse(text,'ORDERING',categories,{items:[]}).actions,[],text);
}
assert.equal(parser.deterministicParse('۲ کباب کوبیده میخوام','ORDERING',categories,{items:[]}).actions[0].quantity,2);
console.log('PASS: menu questions do not order food; explicit quantity still works');

const NextResponse={json:(body,init)=>Response.json(body,init)};
let settings={enabled:true,requireKey:true,apiKey:''};
const user={id:'u',phone:'989123456789',firstName:'Customer',baranCustomerId:null};
const records=[1,2].map(n=>({id:'o'+n,user:{...user},baranFactorNumber:null,createdAt:new Date(),items:[],paymentStatus:'PAID',total:1000}));
let factor=1000, customer=500000;
const db={
  order:{
    findMany:async()=>records.map(o=>({...o,user:{...user}})),
    findUniqueOrThrow:async({where})=>records.find(o=>o.id===where.id),
    aggregate:async()=>({_max:{baranFactorNumber:factor}}),
    updateMany:async({where,data})=>{
      if('baranSentAt' in data) throw Error('storage unavailable');
      const o=records.find(o=>o.id===where.id); if(o.baranFactorNumber===null){o.baranFactorNumber=data.baranFactorNumber;factor=data.baranFactorNumber;}return {count:1};
    },
  },
  user:{findUniqueOrThrow:async()=>user,aggregate:async()=>({_max:{baranCustomerId:customer}}),updateMany:async({data})=>{user.baranCustomerId=data.baranCustomerId;customer=data.baranCustomerId;return {count:1};}},
  baranSyncLog:{create:async()=>{},deleteMany:async()=>{}},
  $transaction:async fn=>fn(db),
};
const baran=await load('src/lib/baran.ts',{db,NextResponse,getSettings:async()=>settings});
const req={headers:new Headers(),nextUrl:new URL('https://example.test')};
assert.equal((await baran.baranGuard(req)).status,503);
settings={...settings,apiKey:'configured'};
assert.equal((await baran.baranGuard(req)).status,401);
const response=await baran.handleGetOrders(req);
assert.equal(response.status,200);
const result=await response.json();
assert.equal(result.BaranStatus,1,JSON.stringify(result));
assert.equal(result.LstOrderModel.length,2);
assert.equal(result.LstOrderModel[0].CustomerId,result.LstOrderModel[1].CustomerId);
assert.ok(result.LstOrderModel[0].CustomerId>500000);
assert.deepEqual((await (await baran.handleGetOrders(req)).json()).LstOrderModel.map(o=>o.FactorNumber),result.LstOrderModel.map(o=>o.FactorNumber));
assert.equal((await baran.handleClearOrders(req,{ItemType:2,ItemIds:'1001'})).status,503);
console.log('PASS: Baran refuses missing key, reuses customer/factor identities, and exposes acknowledgement failures');

const payment=await load('src/lib/payment/zarinpal.ts');
process.env.ZARINPAL_FORCE_REAL='1';
assert.equal(payment.zarinpalBaseUrl({sandbox:true}),'https://payment.zarinpal.com');
console.log('PASS: force-real excludes sandbox');

let paidTransitions=0, logs=0, coupon=0, popularity=0;
const order={id:'order',orderNumber:'NK-TEST',paymentStatus:'PENDING',status:'PENDING_PAYMENT',paymentAuthority:'new-authority',couponCode:'C',total:1000,user:{phone:'09'}};
const payDb={
 paymentAttempt:{findUnique:async()=>({orderId:'order',merchantId:'merchant',sandbox:false,amountToman:1000})},
 order:{findFirst:async()=>({...order}),findUniqueOrThrow:async()=>({...order,items:[],statusLogs:[]}),updateMany:async({where,data})=>{
   if(where.paymentStatus?.not==='PAID' && order.paymentStatus==='PAID') return {count:0};
   if(where.paymentStatus==='PENDING' && (order.paymentStatus!=='PENDING'||order.paymentAuthority!==where.paymentAuthority)) return {count:0};
   Object.assign(order,data);if(data.paymentStatus==='PAID')paidTransitions++;return {count:1};
 }},
 orderStatusLog:{create:async()=>logs++}, orderItem:{findMany:async()=>[{menuItemId:'m',quantity:2}]},
 menuItem:{updateMany:async()=>popularity++},coupon:{updateMany:async()=>coupon++},
};
// Serialize mock transactions like SQLite's single writer.
let tail=Promise.resolve();payDb.$transaction=fn=>{const p=tail.then(()=>fn(payDb));tail=p.catch(()=>{});return p;};
const callback=await load('src/app/api/payment/callback/route.ts',{
 db:payDb,getSettings:async()=>({}),zarinpalVerify:async()=>({success:true,refId:123}),
 notifyAdmins:async()=>{throw Error('notification offline');},notifyCustomer:async()=>{},notifyChatPaymentSuccess:async()=>{},notifyChatPaymentFailed:async()=>{},
 publicUrl:(_req,path)=>'https://example.test'+path,
});
const requests=await Promise.all([1,2].map(()=>callback.GET({url:'https://example.test/api/payment/callback?Authority=old-authority&Status=OK'})));
for(const response of requests) assert.match(response.headers.get('location'),/payment=success/);
assert.equal(paidTransitions,1);assert.equal(logs,1);assert.equal(coupon,1);assert.equal(popularity,1);
await callback.GET({url:'https://example.test/api/payment/callback?Authority=new-authority&Status=NOK'});
assert.equal(order.paymentStatus,'PAID');
console.log('PASS: old-authority callback resolves, concurrent callbacks account once, failed notifications/cancellation do not downgrade paid orders');
