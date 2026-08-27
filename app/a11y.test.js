// Legibility and reach, across every role and — the part that gets skipped — the states
// people only meet when something is wrong: a refused login, a confirmation wall, an
// empty list, a control disabled because there is no signal, a toast explaining a refusal.
//
// Three claims, all measured rather than looked at:
//   contrast   every piece of visible text clears 4.5:1 against what is actually behind
//              it, with alpha composited. An earlier version of this maths threw the
//              alpha away and reported 16:1 for text you could barely read.
//   reach      no control smaller than 36px on its short edge. Above the WCAG floor of
//              24 on purpose: this app is operated in nitrile gloves.
//   width      nothing scrolls sideways. A page you have to drag horizontally loses the
//              row you were reading, which on a job log is the line you just wrote.
const { chromium } = require('playwright-core');
// 320px: the narrowest phone still in service, and the width everything fails at
// first. Passing here means passing wider — the reverse is not true, which is why
// this runs at one width rather than sampling several and taking longer to say less.
const W = +(process.argv[2] || 320);
// Screens, plus the states people only meet when something is wrong or empty.
const CASES = [
  ['login refusal',   null,                {bad:1}],
  ['tech job log',    'yousef@makaman.ly', {st:{activeId:'t3',techScreen:'log',roleTab:'tickets'}}],
  ['tech offline',    'yousef@makaman.ly', {st:{activeId:'t1',techScreen:'log',roleTab:'tickets'}, offline:1}],
  ['tech cancel wall','yousef@makaman.ly', {st:{activeId:'t3',techScreen:'log',roleTab:'tickets'}, dlg:'cancelJob'}],
  ['tech empty',      'yousef@makaman.ly', {empty:1}],
  ['office inbox',    'omar@makaman.ly',   {st:{mgrScreen:'inbox',roleTab:'tickets'}}],
  ['office withdraw', 'omar@makaman.ly',   {st:{activeId:'t2',mgrScreen:'review',roleTab:'tickets'}, dlg:'withdrawTicket'}],
  ['office toast',    'omar@makaman.ly',   {st:{mgrScreen:'inbox',roleTab:'tickets'}, toast:1}],
  ['office empty',    'omar@makaman.ly',   {st:{mgrScreen:'inbox',roleTab:'tickets'}, empty:1}],
  ['office settings', 'omar@makaman.ly',   {st:{showSettings:true}}],
  ['admin account',   'lateri@makaman.ly', {st:{roleTab:'account'}}],
  ['observer',        'founder@makaman.ly',{st:{roleTab:'tickets'}}],
];
const PROBE = () => {
  const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
  const parse=s=>{const n=(s.match(/[\d.]+/g)||[]).map(Number);return{rgb:n.slice(0,3),a:n.length>3?n[3]:1}};
  const over=(f,b)=>f.rgb.map((c,i)=>c*f.a+b.rgb[i]*(1-f.a));
  const ratio=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
  const ground=el=>{const L=[];let n=el;
    while(n){const c=parse(getComputedStyle(n).backgroundColor);if(c.a>0){L.push(c);if(c.a>=1)break}n=n.parentElement}
    if(!L.length||L[L.length-1].a<1)L.push({rgb:[0,0,0],a:1});
    let o=L[L.length-1].rgb;for(let i=L.length-2;i>=0;i--)o=over(L[i],{rgb:o,a:1});return{rgb:o,a:1}};
  const out={contrast:[],taps:[],overflow:null};
  document.querySelectorAll('div,span,button,a,label,td,th,h1,h2,h3,p,option').forEach(el=>{
    const own=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');
    if(!own)return;
    const r=el.getBoundingClientRect(); if(r.width<2||r.height<2)return;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.opacity==='0')return;
    const px=parseFloat(cs.fontSize),w=parseInt(cs.fontWeight,10)||400;
    const need=(px>=24||(px>=18.66&&w>=700))?3:4.5;
    const g=ground(el),v=ratio(over(parse(cs.color),g),g.rgb);
    if(v<need)out.contrast.push(own.slice(0,26)+' ('+v.toFixed(2)+')');
  });
  document.querySelectorAll('button,a[onclick],input[type=checkbox],select').forEach(el=>{
    const r=el.getBoundingClientRect(); if(r.width<1||r.height<1)return;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||el.disabled)return;
    if(r.height<36||r.width<36){
      const t=(el.innerText||el.value||el.type||'').trim().slice(0,20);
      out.taps.push(t+' '+Math.round(r.width)+'x'+Math.round(r.height));
    }
  });
  const de=document.documentElement;
  out.overflow = de.scrollWidth > de.clientWidth + 1 ? (de.scrollWidth+' > '+de.clientWidth) : null;
  return out;
};
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  let nC=0,nT=0,nO=0;
  for(const theme of ['dark','light']){
    for(const [name,email,opt] of CASES){
      const ctx=await b.newContext();const p=await ctx.newPage();
      await p.setViewportSize({width:W,height:900});
      await p.addInitScript(()=>{window.MAKAMAN_CONFIG={authMode:'local'}});
      await p.goto('http://localhost:8934/index.html',{waitUntil:'networkidle'});
      await p.evaluate(()=>localStorage.clear());
      await p.evaluate(t=>localStorage.setItem('makaman.jobtickets.v2',JSON.stringify({settings:{theme:t}})),theme);
      await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(700);
      if(opt.bad){const i=p.locator('input');await i.nth(0).fill('nobody@x.ly');await i.nth(1).fill('wrongpass');
        await p.getByRole('button',{name:/log in/i}).click();await p.waitForTimeout(900);}
      else if(opt.forgot){await p.getByText(/Forgot your password/i).click();await p.waitForTimeout(400);}
      else if(email){
        const i=p.locator('input');await i.nth(0).fill(email);await i.nth(1).fill('makaman2026');
        await p.getByRole('button',{name:/log in/i}).click();await p.waitForTimeout(1400);
        await p.evaluate(t=>window.__mkApp.updateSettings({theme:t}),theme);
        if(opt.empty)await p.evaluate(()=>window.__mkApp.mutate(d=>{d.tickets=[]}));
        if(opt.offline)await p.evaluate(()=>window.__mkApp.setState({online:false}));
        if(opt.st)await p.evaluate(s=>window.__mkApp.setState(s),opt.st);
        if(opt.dlg)await p.evaluate(d=>window.__mkApp.setState({dialog:d}),opt.dlg);
        if(opt.toast)await p.evaluate(()=>window.__mkApp.toast('probe','Something was refused, and this is why.','warn'));
        await p.waitForTimeout(800);
      }
      const r=await p.evaluate(PROBE);
      nC+=r.contrast.length;nT+=r.taps.length;nO+=r.overflow?1:0;
      const bits=[];
      if(r.contrast.length)bits.push('contrast '+r.contrast.length+': '+r.contrast.slice(0,2).join(' | '));
      if(r.taps.length)bits.push('small taps '+r.taps.length+': '+[...new Set(r.taps)].slice(0,3).join(' | '));
      if(r.overflow)bits.push('OVERFLOW '+r.overflow);
      if(bits.length)console.log(('  '+theme[0]+' '+name).padEnd(24)+bits.join('   '));
      await ctx.close();
    }
  }
  const bad = nC + nT + nO;
  console.log('\n  @'+W+'px  contrast below 4.5:1 — '+nC+'   tap targets under 36px — '+nT+'   screens scrolling sideways — '+nO);
  console.log('\n  '+(bad?0:3)+' passed, '+(bad?1:0)+' failed');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
