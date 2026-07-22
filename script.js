const $=(s,c=document)=>c.querySelector(s);const $$=(s,c=document)=>[...c.querySelectorAll(s)];
$('#year')&&($('#year').textContent=new Date().getFullYear());
const burger=$('.burger'),nav=$('.nav');
burger?.addEventListener('click',()=>{const open=nav?.classList.toggle('open');burger.setAttribute('aria-expanded',open?'true':'false');burger.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню')});
nav?.addEventListener('click',e=>{if(e.target.closest('a')&&nav.classList.contains('open')){nav.classList.remove('open');burger?.setAttribute('aria-expanded','false');burger?.setAttribute('aria-label','Открыть меню')}});
const io=new IntersectionObserver((entries)=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}}),{threshold:.12});$$('.reveal').forEach(el=>io.observe(el));
const cookie=$('.cookie');if(cookie&&!localStorage.getItem('lstpro_cookie_ok')) cookie.classList.add('show');
$('#acceptCookies')?.addEventListener('click',()=>{localStorage.setItem('lstpro_cookie_ok','1');cookie.classList.remove('show')});
