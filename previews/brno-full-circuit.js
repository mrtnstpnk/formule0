(function () {
  "use strict";

  // Relative plan units: the original 40-wide road becomes 80 wide.
  // Positive balance adds the new lane on the driver's left; negative on right.
  const ORIGINAL_HALF_WIDTH = 20;
  const WIDTH = 80;
  const original = [
    [380,590], [320,590], [240,590], [160,590], [85,590],
    [45,580], [23,550], [23,516], [43,487], [80,475],
    [140,466], [210,442], [280,410], [350,377], [408,348],
    [433,324], [433,296], [415,273], [390,253], [378,225],
    [383,195], [409,169], [472,124], [535,78], [592,37],
    [620,24], [645,32], [660,61], [669,94], [657,120],
    [625,134], [602,147], [590,173], [600,199], [628,214],
    [670,219], [714,225], [740,215], [754,192], [755,165],
    [769,141], [794,131], [824,142], [885,180],
    [950,220], [1012,259], [1056,288], [1075,312], [1072,338],
    [1051,358], [1022,363], [966,355], [911,346], [884,353],
    [868,375], [865,407], [851,430], [822,442], [770,445],
    [700,447], [630,450], [563,455], [531,468], [509,493],
    [501,523], [497,550], [476,575], [447,590], [410,596],
  ];
  const revised = original.map(p => p.slice());
  const changes = {
    // Deepen the first hairpin by 70 units, leaving its left/right footprint
    // and the approved turn-2 exit in place. The bottom straight moves down.
    0:[380,660], 1:[320,660], 2:[240,660], 3:[160,660], 4:[85,660],
    5:[45,643], 6:[23,599], 7:[23,538], 8:[43,495],
    // Shorten the approach to turn 3 and blend back into turn 4.
    13:[322,393], 14:[380,364], 15:[405,340], 16:[405,312],
    17:[395,284], 18:[380,259],
    // Move the 5/6 pair slightly left and extend the down-going straight.
    22:[466,124], 23:[523,78], 24:[580,37],
    25:[608,24], 26:[633,32], 27:[648,61], 28:[657,118],
    29:[645,144], 30:[613,158],
    // Make room for turn 7, then lengthen 7–8 and move 8/9 to the right.
    31:[590,182], 32:[578,208], 33:[588,234], 34:[616,249],
    35:[686,254], 36:[754,260], 37:[780,250], 38:[794,227],
    39:[795,200], 40:[809,176], 41:[834,166], 42:[864,177], 43:[925,215],
    // Continue the turn-9 straight into the outward-widened turn 10.
    44:[990,255], 45:[1052,294], 46:[1096,323], 47:[1115,347],
    48:[1112,373], 49:[1091,393], 50:[1062,398], 51:[1006,390], 52:[956,362],
    // Complete the 11/12 S and its return straight at the same 80-unit width.
    53:[922.06,376.06], 54:[908,410], 55:[905,442], 56:[891,465],
    57:[862,477], 58:[810,480], 59:[740,482], 60:[670,485],
    // Open the final 13/14 S vertically to meet the lower start straight.
    61:[603,490], 62:[565,504], 63:[538,533], 64:[529,570],
    65:[526,600], 66:[514,630], 67:[491,650], 68:[452,661],
  };
  for (const [i, point] of Object.entries(changes)) revised[i] = point;
  const balance = original.map((_, i) => {
    if (i <= 11) return 1;
    if (i === 12 || i === 18 || i === 39) return 0;
    if ((i >= 13 && i <= 17) || (i >= 31 && i <= 38)) return -1;
    if (i === 52 || i === 55 || i === 61 || i === 65) return 0;
    if ((i >= 53 && i <= 54) || (i >= 62 && i <= 64)) return -1;
    return 1;
  });
  const turns = [
    { n:1, anchor:7, side:"left", label:[-87,575] },
    { n:2, anchor:10, side:"left", label:[95,370] },
    { n:3, anchor:16, side:"right", label:[493,351] },
    { n:4, anchor:19, side:"left", label:[271,201] },
    { n:5, anchor:25, side:"left", label:[558,-66] },
    { n:6, anchor:28, side:"left", label:[746,104] },
    { n:7, anchor:32, side:"right", label:[486,212] },
    { n:8, anchor:36, side:"right", label:[795,350] },
    { n:9, anchor:41, side:"left", label:[904,103] },
    { n:10, anchor:48, side:"left", label:[1234,368] },
    { n:11, anchor:54, side:"right", label:[815,417] },
    { n:12, anchor:56, side:"left", label:[969,518] },
    { n:13, anchor:63, side:"right", label:[436,502] },
    { n:14, anchor:66, side:"left", label:[606,693] },
  ];

  function catmull(p0,p1,p2,p3,t) {
    return 0.5 * (2*p1 + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t*t + (-p0+3*p1-3*p2+p3)*t*t*t);
  }
  function sample(anchors) {
    const points = [];
    const count=anchors.length;
    for (let i=0;i<count;i++) {
      const a=anchors[(i+count-1)%count], b=anchors[i], c=anchors[(i+1)%count], d=anchors[(i+2)%count];
      for (let s=0;s<12;s++) {
        const t=s/12, smooth=t*t*(3-2*t);
        points.push({ x:catmull(a[0],b[0],c[0],d[0],t), y:catmull(a[1],b[1],c[1],d[1],t),
          balance:balance[i]+(balance[(i+1)%count]-balance[i])*smooth });
      }
    }
    return points;
  }
  function edges(points, widened) {
    return points.map((p,i) => {
      const a=points[(i+points.length-1)%points.length], b=points[(i+1)%points.length];
      const length=Math.hypot(b.x-a.x,b.y-a.y);
      const leftNormal={ x:(b.y-a.y)/length, y:-(b.x-a.x)/length };
      const leftWidth=widened ? WIDTH/2 + ORIGINAL_HALF_WIDTH*p.balance : ORIGINAL_HALF_WIDTH;
      const rightWidth=widened ? WIDTH-leftWidth : ORIGINAL_HALF_WIDTH;
      return { center:p, normal:leftNormal,
        left:{x:p.x+leftNormal.x*leftWidth,y:p.y+leftNormal.y*leftWidth},
        right:{x:p.x-leftNormal.x*rightWidth,y:p.y-leftNormal.y*rightWidth},
        baseLeft:{x:p.x+leftNormal.x*20,y:p.y+leftNormal.y*20},
        baseRight:{x:p.x-leftNormal.x*20,y:p.y-leftNormal.y*20} };
    });
  }
  function softenCurveTransitions(sections) {
    const count=sections.length;
    const sigma=16, support=sigma*4;
    const lengths=sections.map((s,i)=>{
      const next=sections[(i+1)%count];
      return Math.hypot(next.center.x-s.center.x,next.center.y-s.center.y);
    });
    // Fair both boundaries in physical distance, not sample count. A compact
    // smooth window spreads each abrupt curvature change over a short arc.
    // Reproject the paired edges to keep every cross-section 80 units wide.
    return sections.map((section,i)=>{
      let lx=0,ly=0,rx=0,ry=0,bias=0,total=0;
      function accumulate(index,distance) {
        const s=sections[index],u=distance/support;
        const weight=Math.exp(-0.5*(distance/sigma)**2)*(1-u*u)**3
          *(lengths[(index+count-1)%count]+lengths[index])/2;
        lx+=s.left.x*weight; ly+=s.left.y*weight;
        rx+=s.right.x*weight; ry+=s.right.y*weight;
        bias+=s.center.balance*weight; total+=weight;
      }
      accumulate(i,0);
      for (const direction of [-1,1]) {
        let index=i,distance=0;
        for (let step=1;step<count;step++) {
          distance+=direction>0?lengths[index]:lengths[(index+count-1)%count];
          index=(index+direction+count)%count;
          if (distance>=support) break;
          accumulate(index,distance);
        }
      }
      lx/=total; ly/=total; rx/=total; ry/=total; bias/=total;
      const center={x:(lx+rx)/2,y:(ly+ry)/2,balance:bias};
      const separation=Math.hypot(lx-rx,ly-ry);
      const normal={x:(lx-rx)/separation,y:(ly-ry)/separation};
      const at=distance=>({x:center.x+normal.x*distance,y:center.y+normal.y*distance});
      return {center,normal,left:at(WIDTH/2),right:at(-WIDTH/2),
        baseLeft:at(20-20*bias),baseRight:at(-20-20*bias)};
    });
  }
  function buildGeometry() {
    const reference=edges(sample(revised),true);
    const centers=reference.map(s=>({x:(s.left.x+s.right.x)/2,y:(s.left.y+s.right.y)/2}));
    const count=reference.length;
    const sections=reference.map((s,i)=>({...s,center:{...centers[i],balance:s.center.balance}}));
    const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
    const smooth=t=>t*t*t*(t*(t*6-15)+10);
    // Straight ranges in the existing sample grid, with smooth blends
    // into the approved corner outlines. The actual road center is used,
    // so both walls stay parallel and exactly WIDTH units apart.
    const straights=[
      {start:0,end:42,blend:12,horizontal:true},
      {start:126,end:162,blend:18,lead:6},
      {start:252,end:288,blend:8},
      {start:324,end:330,blend:5},
      {start:408,end:426,blend:6},
      {start:510,end:546,blend:9},
      {start:606,end:612,blend:12},
      {start:696,end:726,blend:12},
    ];
    for (const run of straights) {
      const {start,end,blend}=run,lead=run.lead??blend;
      const a=run.horizontal?{x:380,y:680}:centers[start];
      const b=run.horizontal?{x:85,y:680}:centers[end];
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const lineNormal={x:dy/length,y:-dx/length};
      const firstBalance=reference[start].center.balance,lastBalance=reference[end].center.balance;
      for (let index=start-lead;index<=end+blend;index++) {
        const i=(index+count)%count,old=reference[i],p=centers[i];
        const weight=smooth(clamp(Math.min((index-start+lead)/lead,(end+blend-index)/blend),0,1));
        const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(length*length);
        const center={x:p.x+weight*(a.x+dx*t-p.x),y:p.y+weight*(a.y+dy*t-p.y)};
        const nx=old.normal.x+weight*(lineNormal.x-old.normal.x),ny=old.normal.y+weight*(lineNormal.y-old.normal.y);
        const normalLength=Math.hypot(nx,ny),normal={x:nx/normalLength,y:ny/normalLength};
        const targetBalance=firstBalance+(lastBalance-firstBalance)*clamp(t,0,1);
        const bias=old.center.balance+weight*(targetBalance-old.center.balance);
        const at=distance=>({x:center.x+normal.x*distance,y:center.y+normal.y*distance});
        sections[i]={center:{...center,balance:bias},normal,left:at(WIDTH/2),right:at(-WIDTH/2),
          baseLeft:at(20-20*bias),baseRight:at(-20-20*bias)};
      }
    }
    const rounded=softenCurveTransitions(sections);
    for (let i=0;i<count;i++) sections[i]=rounded[i];
    // Keep direction arrows on the center of the original-width gray lane.
    const centerline=sections.map(s=>({
      x:s.center.x-20*s.center.balance*s.normal.x,
      y:s.center.y-20*s.center.balance*s.normal.y,
      balance:s.center.balance,
    }));
    return { centerline, sections, original:sample(original), originalEdges:edges(sample(original),false), turns,
      boundaryPolygons:[sections.map(s=>s.left),sections.map(s=>s.right)], width:WIDTH, straights };
  }
  const coord=p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const path=(points,closed=false)=>`M ${points.map(coord).join(" L ")}${closed ? " Z" : ""}`;
  const ring=(a,b)=>`<path fill-rule="evenodd" d="${path(a,true)} ${path(b,true)}"/>`;
  function label(x,y,text,anchor="start",size=16) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}">${text}</text>`;
  }
  function renderSvg() {
    const g=buildGeometry(), s=g.sections;
    const strip=(a,b)=>ring(s.map(p=>p[a]),s.map(p=>p[b]));
    const callout=(text,x,y,target)=>`<g class="callout"><path d="M ${x},${y+8} L ${target[0]},${target[1]}"/>${label(x,y,text)}</g>`;
    const turnMarkup=turns.map(turn=>{
      const section=s[turn.anchor*12], sign=turn.side==="left"?1:-1;
      const edge=turn.side==="left"?section.left:section.right;
      const tip={x:edge.x+section.normal.x*sign*8,y:edge.y+section.normal.y*sign*8};
      const color=turn.side==="left"?"#087f72":"#1d4ed8";
      return `<g class="turn"><path d="M ${turn.label[0]},${turn.label[1]} L ${tip.x},${tip.y}" stroke="${color}"/>
        <circle cx="${turn.label[0]}" cy="${turn.label[1]}" r="19" fill="${color}"/>
        <text x="${turn.label[0]}" y="${turn.label[1]+1}" text-anchor="middle" dominant-baseline="middle" fill="white" font-weight="700" font-size="19">${turn.n}</text></g>`;
    }).join("");
    const arrows=[2,10,13,21,27,33,35,39,44,48,52,55,59,63,66].map(anchor=>{
      const i=anchor*12+4;
      const p=g.centerline[i], next=g.centerline[(i+1)%g.centerline.length], angle=Math.atan2(next.y-p.y,next.x-p.x)*180/Math.PI;
      return `<path transform="translate(${p.x},${p.y}) rotate(${angle})" d="M -6,-6 L 3,0 L -6,6"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-165 -145 1510 1105" role="img" aria-labelledby="sector-title sector-desc">
      <title id="sector-title">Brno: dokončený návrh celého okruhu se 14 zatáčkami</title>
      <desc id="sector-desc">Uzavřený okruh široký 80 místo 40. Za devátou zatáčkou pokračuje rovinka a desátá zatáčka rozšířená ven. Zatáčky 11 až 14 uzavírají okruh ve stejné šířce. První vracečka má větší poloměr a startovní rovinka leží o 70 jednotek níže.</desc>
      <style>text{font-family:system-ui,-apple-system,sans-serif;fill:#334155} .turn path{fill:none;stroke-width:1.5}.turn text{fill:white}.callout path{fill:none;stroke:#94a3b8;stroke-width:1.5}.callout text{font-size:15px;font-weight:600}.original{fill:none;stroke:#a16207;stroke-width:1.6;stroke-dasharray:7 6;opacity:.65}.hide-original .original{display:none}</style>
      <rect x="-165" y="-145" width="1510" height="1105" fill="#f8fafc"/>
      ${label(-110,-94,"BRNO / CELÝ OKRUH","start",28)}
      ${label(-110,-62,"Jednotná šířka 80 · plynulé přechody zatáček · větší první vracečka","start",17)}
      <g fill="#e2e8f0">${ring(...g.boundaryPolygons)}</g>
      <g fill="#99f6e4">${strip("left","baseLeft")}</g>
      <g fill="#bfdbfe">${strip("baseRight","right")}</g>
      <g fill="none" stroke="#0f172a" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">
        <path d="${path(s.map(p=>p.left),true)}"/><path d="${path(s.map(p=>p.right),true)}"/>
      </g>
      <g class="original"><path d="${path(g.original,true)}"/></g>
      <g fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round">${arrows}</g>
      <path d="M 320,640 L 320,720" stroke="#fff" stroke-width="9"/>
      <path d="M 320,640 L 320,720" stroke="#0f172a" stroke-width="9" stroke-dasharray="10 10"/>
      ${label(343,752,"START / CÍL","start",15)}
      <g stroke="#334155" stroke-width="1.5"><path d="M 240,640 L 240,720 M 233,646 L 240,640 L 247,646 M 233,714 L 240,720 L 247,714" fill="none"/></g>
      ${label(260,687,"2×","start",17)}
      ${turnMarkup}
      ${callout("Kratší rovinka 2–3",145,288,[270,423])}
      ${callout("Delší rovinka 5–6",749,-5,[653,88])}
      ${callout("Delší rovinka 7–8",649,374,[692,254])}
      ${callout("Navazující rovinka 9–10",1060,154,[1010,267])}
      ${callout("Větší poloměr 1. vracečky",-90,782,[24,598])}
      <g transform="translate(435 802)">
        ${label(0,0,"KAM SE VOZOVKA ROZŠIŘUJE","start",15)}
        <rect x="0" y="21" width="22" height="16" rx="3" fill="#99f6e4"/>
        ${label(34,35,"Vlevo vně: 1, 2, 4, 5, 6, 9, 10, 12, 14","start",17)}
        <rect x="0" y="57" width="22" height="16" rx="3" fill="#bfdbfe"/>
        ${label(34,71,"Vpravo dovnitř okruhu: 3, 7, 8, 11, 13","start",17)}
        <rect x="0" y="93" width="22" height="16" rx="3" fill="#e2e8f0"/>
        ${label(34,107,"Základní pás šířky 40","start",17)}
        <path d="M 510,29 L 533,29" stroke="#a16207" stroke-width="2" stroke-dasharray="5 4"/>
        ${label(544,35,"Původní stopa","start",15)}
        ${label(510,71,"Nová šířka 80 / původní 40","start",17)}
      </g>
    </svg>`;
  }
  const api={buildGeometry,renderSvg,original,revised,turns};
  if (typeof module!=="undefined" && module.exports) module.exports=api;
  if (typeof document!=="undefined") {
    document.getElementById("diagram").innerHTML=renderSvg();
    document.getElementById("original-toggle").addEventListener("change",event=>{
      document.getElementById("diagram").classList.toggle("hide-original",!event.target.checked);
    });
  }
})();
