const MERCHANT=new URLSearchParams(location.search).get('merchant')||'http://localhost:4100';
const $=id=>document.getElementById(id);
let port=null,payload=null;
// A parent page can communicate only if the exact origin and source match.
window.addEventListener('message',event=>{
 if(event.origin!==MERCHANT||event.source!==window.opener||event.data?.type!=='review-transfer'||!event.ports?.[0])return;
 port=event.ports[0];payload=event.data.payload;
 if(!payload||typeof payload!=='object')return;
 $('order').textContent=payload.orderReference;
 $('damage').textContent=payload.damageDescription;
 $('address').textContent=Object.hasOwn(payload,'deliveryAddress')?payload.deliveryAddress:'Not shared';
 $('info').textContent='The courier will receive the fields shown below.';
 $('actions').style.display='block';
});
window.opener?.postMessage({type:'courier-ready'},MERCHANT);
$('decline').onclick=()=>{port?.postMessage({type:'declined'});$('info').textContent='Transfer declined. No case was created.';$('actions').style.display='none';};
$('approve').onclick=async()=>{
 $('approve').disabled=true;$('decline').disabled=true;$('info').textContent='Submitting to courier service...';
 try {
  const session=await fetch('/api/session').then(r=>{if(!r.ok)throw Error('Courier session unavailable');return r.json()});
  const response=await fetch('/api/cases',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Submission failed');
  port?.postMessage({type:'submitted',receipt:result.receipt});
  $('info').textContent='Accepted. Signed receipt sent to the merchant.';
  $('actions').style.display='none';
 }catch(e){port?.postMessage({type:'error',message:e.message});$('info').textContent='Could not confirm submission: '+e.message;$('approve').disabled=false;$('decline').disabled=false;}
};
