(function(){'use strict';
var $=function(s,r){return(r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var fa=function(n,d){return isFinite(n)?Number(n).toLocaleString('fa-IR',{maximumFractionDigits:d||0}):'—'};
var S=$$('.sl'),N=S.length,cur=-1,prevEl=null;
/* word split */
$$('.sw').forEach(function(h){var k=0;h.innerHTML=h.textContent.trim().split(/\s+/).map(function(w){return '<span class="w"><i style="--k:'+(k++)+'">'+w+'</i></span>'}).join(' ')});
function go(i){
 i=Math.max(0,Math.min(N-1,i));if(i===cur)return;
 if(prevEl)prevEl.classList.remove('prev');
 if(cur>=0){prevEl=S[cur];prevEl.classList.remove('on');prevEl.classList.add('prev')}
 cur=i;S[i].classList.remove('prev');S[i].classList.add('on');
 var paper=S[i].classList.contains('paper');document.body.classList.toggle('pp',paper);
 $('#bar').style.width=(N>1?i/(N-1)*100:0)+'%';$('#cnt').textContent=fa(i+1)+' / '+fa(N);$('#act').textContent=S[i].getAttribute('data-act')||'';
 $('#noteTxt').textContent=S[i].getAttribute('data-note')||'';
 $('#brandImg').src=IMG[paper?'logo_b':'logo_t'];
 $('#brand').style.opacity=i===0||i===N-1?0:.95;
 $$('[data-ov]').forEach(function(b,k){b.classList.toggle('cur',k===i)});
 $('#ov').classList.remove('on');
 try{if(location.hash!=='#'+(i+1))history.replaceState(null,'','#'+(i+1))}catch(e){}
}
function next(){go(cur+1)}function prev(){go(cur-1)}
$('#bNext').onclick=next;$('#bPrev').onclick=prev;
$('#bNote').onclick=function(){$('#notes').classList.toggle('on')};
$('#bOv').onclick=function(){$('#ov').classList.toggle('on')};
$('#bFs').onclick=function(){try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}catch(e){}};
document.addEventListener('keydown',function(e){
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
 var k=e.key;
 if(k==='ArrowLeft'||k==='PageDown'||k===' '||k==='Enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();next()}
 else if(k==='ArrowRight'||k==='PageUp'){e.preventDefault();prev()}
 else if(k==='Home')go(0);else if(k==='End')go(N-1);
 else if(k==='o'||k==='O')$('#ov').classList.toggle('on');
 else if(k==='n'||k==='N')$('#notes').classList.toggle('on');
 else if(k==='f'||k==='F')$('#bFs').click();
 else if(k==='Escape'){$('#ov').classList.remove('on');$('#notes').classList.remove('on')}
});
var tx=null;document.addEventListener('touchstart',function(e){tx=e.touches[0].clientX},{passive:true});
document.addEventListener('touchend',function(e){if(tx===null)return;var d=e.changedTouches[0].clientX-tx;tx=null;if(Math.abs(d)>70){var s=e.target.closest('.in');d>0?next():prev()}},{passive:true});
/* wheel nav on desktop */
var wl=0;document.addEventListener('wheel',function(e){var in_=e.target.closest&&e.target.closest('.in');if(in_&&in_.scrollHeight>in_.clientHeight+4)return;var t=Date.now();if(t-wl<1200||Math.abs(e.deltaY)<30)return;wl=t;e.deltaY>0?next():prev()},{passive:true});
/* overview */
$('#ovGrid').innerHTML=S.map(function(s,i){return '<button data-ov="'+i+'"><b>'+fa(i+1)+' · '+s.getAttribute('data-act')+'</b>'+s.getAttribute('data-title')+'</button>'}).join('');
$$('[data-ov]').forEach(function(b){b.onclick=function(){go(+b.getAttribute('data-ov'))}});
$('#ovClose').onclick=function(){$('#ov').classList.remove('on')};
/* count up */
/* flip cards */
$$('.flip').forEach(function(f){f.onclick=function(){f.classList.toggle('f')}});
/* decisions */
$$('.dec').forEach(function(d){d.onclick=function(){d.classList.toggle('ck')}});
/* internet toggle */
$$('[data-net]').forEach(function(b){b.onclick=function(){var on=b.getAttribute('data-net')==='1';$$('[data-net]').forEach(function(x){x.classList.toggle('on',x===b)});
 $$('#netList .net').forEach(function(n){var ext=n.getAttribute('data-i')==='1';n.classList.toggle('x',ext);n.classList.toggle('cut',ext&&!on);$('em',n).textContent=ext?(on?'خارج از برنامه':'قطع می‌شود'):'همیشه در دسترس'})}});
$$('#netList .net').forEach(function(n){var ext=n.getAttribute('data-i')==='1';n.classList.toggle('x',ext);$('em',n).textContent=ext?'خارج از برنامه':'همیشه در دسترس'});
/* checklists */
var L=[['مدت قرارداد و شرایط تمدید چیست؟','ودیعه یا رهن چقدر است و چه زمانی برمی‌گردد؟','تعمیرات و هزینه‌های ساختمان با کیست؟','شرایط فسخ یا تخلیه چیست؟','همه تعهدها نوشته شده‌اند یا فقط قول شفاهی است؟'],
['فروشنده همان مالک واقعی است؟','سند و وضعیت قانونی خودرو بررسی شده؟','کارشناسی مستقل انجام شده؟','بیعانه و شرط برگشت آن نوشته شده؟','زمان و محل انتقال سند مشخص است؟'],
['شرح وظایف و ساعت کار روشن است؟','حقوق، مزایا و زمان پرداخت نوشته شده؟','مدت قرارداد و شرایط پایان آن چیست؟','وضعیت بیمه چگونه است؟','بند محرمانگی یا منع همکاری چه می‌گوید؟'],
['تاریخ، مبلغ و صاحب حساب درست است؟','طرف مقابل را می‌شناسی و سابقه‌اش را؟','علت صدور چک مستند است؟','اگر برگشت خورد، قدم بعدی چیست؟','مهلت‌ها را می‌دانی؟']];
function showCk(k){$('#ckList').innerHTML=L[k].map(function(t){return '<button class="ckr"><i></i><span>'+t+'</span></button>'}).join('');$$('#ckList .ckr').forEach(function(b){b.onclick=function(){b.classList.toggle('ck')}})}
$$('#ckTabs button').forEach(function(b){b.onclick=function(){$$('#ckTabs button').forEach(function(x){x.classList.toggle('on',x===b)});showCk(+b.getAttribute('data-k'))}});showCk(0);
/* budget engine (same model as the xlsx) */
var CH=[{n:'یکتانت',c:[5500,4000,3400],k:[1,1,1],q:1.0},{n:'تپسل',c:[4000,3000,2600],k:[1,1,1],q:.7},{n:'دیوار',c:[7000,5000,4200],k:[1,1,1],q:1.2},{n:'پیام‌رسان‌های داخلی',c:[5000,3500,3000],k:[1,1,1],q:.8},{n:'آپارات',c:[500,400,350],k:[.004,.007,.009],q:.9,brand:.3},{n:'صباویژن',c:[80000,60000,52000],k:[1.5,2.5,3],q:.9,brand:.3},{n:'گزارش خبری',c:[6e6,5e6,4.5e6],k:[600,1200,1600],q:1.1},{n:'همکاری کارشناس',c:[15e6,12.5e6,11e6],k:[400,750,1000],q:1.0,brand:.4}];
var F1=[.15,.22,.27],F2=[.30,.40,.45],F3=[.35,.45,.50];
var R={s:1,total:500e6,tax:10,cap:350000,sat:15,res:15,share:[]};
function funnel(s){return F1[s]*F2[s]*F3[s]}
function calc(s,i,spend,cost){var eff=spend/(1+R.tax/100),ch=CH[i],units=cost>0?eff/cost:0,clicks=units*ch.k[s],ses=clicks*.85,st=ses*F1[s]*ch.q,su=st*F2[s],sat=1/(1+R.sat/100*(eff/1e6/150));return{ses:ses,act:su*F3[s]*sat}}
function perfCAC(i){var c=CH[i];return c.c[R.s]/(c.k[R.s]*.85*funnel(R.s)*c.q)}
function auto(){var brand=[],perf=[],i;for(i=0;i<CH.length;i++)(CH[i].brand?brand:perf).push(i);
 var res=R.res,bw=brand.reduce(function(a,i){return a+CH[i].brand},0);brand.forEach(function(i){R.share[i]=res*CH[i].brand/bw});
 var rest=100-res,w=perf.map(function(i){return 1/perfCAC(i)}),ws=w.reduce(function(a,b){return a+b},0),sh=w.map(function(x){return x/ws*rest});
 var cap=Math.max(40,rest/perf.length+1),mn=Math.min(5,rest/perf.length);
 for(var it=0;it<8;it++){var ex=0,fr=[];sh.forEach(function(x,j){if(x>cap){ex+=x-cap;sh[j]=cap}else if(x<mn){ex-=mn-x;sh[j]=mn}else fr.push(j)});if(!fr.length||Math.abs(ex)<.001)break;var fs=fr.reduce(function(a,j){return a+sh[j]},0);fr.forEach(function(j){sh[j]+=ex*sh[j]/fs})}
 perf.forEach(function(i,j){R.share[i]=Math.max(0,sh[j])})}
function upd(){auto();var sumA=0,mx=0;var rows=CH.map(function(c,i){var sp=R.total*R.share[i]/100,r=calc(R.s,i,sp,c.c[R.s]);sumA+=r.act;return{n:c.n,sh:R.share[i],sp:sp,act:r.act}});
 rows.forEach(function(r){mx=Math.max(mx,r.sh)});
 $('#bars').innerHTML=rows.map(function(r){return '<div class="br"><span>'+r.n+'</span><div class="tk"><i style="--w:'+(r.sh/mx*100).toFixed(1)+'%"></i></div><span class="mut">'+fa(r.sp/1e6,1)+' م</span></div>'}).join('');
 var cac=sumA>0?R.total/sumA:NaN;$('#bTot').textContent=fa(R.total/1e6)+' میلیون تومان';$('#kA').textContent=fa(sumA);$('#kC').textContent=fa(cac/1000);
 $('#kF').innerHTML=cac<=R.cap?'<span class="ok">در سقف ۳۵۰ هزار تومان</span>':'<span class="bad">بالاتر از سقف ۳۵۰ هزار تومان</span>'}
$('#bR').oninput=function(){R.total=+this.value*1e6;$$('[data-p]').forEach(function(b){b.classList.toggle('on',+b.getAttribute('data-p')===+$('#bR').value)});upd()};
$$('[data-p]').forEach(function(b){b.onclick=function(){$('#bR').value=b.getAttribute('data-p');$('#bR').oninput()}});
$$('[data-s]').forEach(function(b){b.onclick=function(){R.s=+b.getAttribute('data-s');$$('[data-s]').forEach(function(x){x.classList.toggle('on',x===b)});upd()}});
upd();
var m=/^#(\d+)$/.exec(location.hash);go(m?+m[1]-1:0);
window.__go=go;
})();
