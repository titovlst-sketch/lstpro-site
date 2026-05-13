const $=(s,c=document)=>c.querySelector(s);const $$=(s,c=document)=>[...c.querySelectorAll(s)];
$('#year')&&($('#year').textContent=new Date().getFullYear());
$('.burger')?.addEventListener('click',()=>$('.nav')?.classList.toggle('open'));
const io=new IntersectionObserver((entries)=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}}),{threshold:.12});$$('.reveal').forEach(el=>io.observe(el));
const cookie=$('.cookie');if(cookie&&!localStorage.getItem('lstpro_cookie_ok')) cookie.classList.add('show');
$('#acceptCookies')?.addEventListener('click',()=>{localStorage.setItem('lstpro_cookie_ok','1');cookie.classList.remove('show')});
