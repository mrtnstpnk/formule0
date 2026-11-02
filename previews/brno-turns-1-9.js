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
  ];
  const revised = original.map(p => p.slice());
  const changes = {
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
  };
  for (const [i, point] of Object.entries(changes)) revised[i] = point;
  const balance = original.map((_, i) => {
    if (i <= 11) return 1;
    if (i === 12 || i === 18 || i === 31 || i === 39) return 0;
    if ((i >= 13 && i <= 17) || (i >= 32 && i <= 38)) return -1;
    return 1;
  });
  const turns = [
    { n:1, anchor:7, side:"left", label:[-87,535] },
    { n:2, anchor:10, side:"left", label:[95,370] },
    { n:3, anchor:16, side:"right", label:[493,351] },
    { n:4, anchor:19, side:"left", label:[271,201] },
    { n:5, anchor:25, side:"left", label:[558,-66] },
    { n:6, anchor:28, side:"left", label:[746,104] },
    { n:7, anchor:32, side:"right", label:[486,212] },
    { n:8, anchor:36, side:"right", label:[795,350] },
    { n:9, anchor:41, side:"left", label:[904,103] },
  ];

  function catmull(p0,p1,p2,p3,t) {
    return 0.5 * (2*p1 + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t*t + (-p0+3*p1-3*p2+p3)*t*t*t);
  }
  function sample(anchors) {
    const points = [];
    for (let i=0;i<anchors.length-1;i++) {
      const a=anchors[Math.max(i-1,0)], b=anchors[i], c=anchors[i+1], d=anchors[Math.min(i+2,anchors.length-1)];
      for (let s=0;s<12;s++) {
        const t=s/12, smooth=t*t*(3-2*t);
        points.push({ x:catmull(a[0],b[0],c[0],d[0],t), y:catmull(a[1],b[1],c[1],d[1],t),
          balance:balance[i]+(balance[i+1]-balance[i])*smooth });
      }
    }
    const last=anchors.at(-1);
    points.push({ x:last[0], y:last[1], balance:balance.at(-1) });
    return points;
  }
  function edges(points, widened) {
    return points.map((p,i) => {
      const a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)];
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
  function buildGeometry() {
    const centerline=sample(revised), sections=edges(centerline,true);
    return { centerline, sections, original:sample(original), originalEdges:edges(sample(original),false), turns,
      polygon:sections.map(s=>s.left).concat(sections.map(s=>s.right).reverse()), width:WIDTH };
  }
  const coord=p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const path=(points,closed=false)=>`M ${points.map(coord).join(" L ")}${closed ? " Z" : ""}`;
  const polygon=points=>`<path d="${path(points,true)}"/>`;
  function label(x,y,text,anchor="start",size=16) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}">${text}</text>`;
  }
  function renderSvg() {
    const g=buildGeometry(), s=g.sections;
    const strip=(a,b)=>polygon(s.map(p=>p[a]).concat(s.map(p=>p[b]).reverse()));
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
    const arrows=[24,99,150,238,296,335,411,458,500].map(i=>{
      const p=g.centerline[i], next=g.centerline[i+1], angle=Math.atan2(next.y-p.y,next.x-p.x)*180/Math.PI;
      return `<path transform="translate(${p.x},${p.y}) rotate(${angle})" d="M -6,-6 L 3,0 L -6,6"/>`;
    }).join("");
    const end=s.at(-1);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-145 -145 1235 890" role="img" aria-labelledby="sector-title sector-desc">
      <title id="sector-title">Brno: jednostranné rozšíření zatáček 1 až 9</title>
      <desc id="sector-desc">Vozovka široká 80 místo 40. Zatáčky 1, 2, 4, 5, 6 a 9 rozšířené vlevo. Zatáčky 3, 7 a 8 vpravo do vnitřku okruhu. Rovinka před 3 je kratší, rovinky 5–6 a 7–8 delší. Náhled končí za zatáčkou 9.</desc>
      <style>text{font-family:system-ui,-apple-system,sans-serif;fill:#334155} .turn path{fill:none;stroke-width:1.5}.turn text{fill:white}.callout path{fill:none;stroke:#94a3b8;stroke-width:1.5}.callout text{font-size:15px;font-weight:600}.original{fill:none;stroke:#a16207;stroke-width:1.6;stroke-dasharray:7 6;opacity:.65}.hide-original .original{display:none}</style>
      <rect x="-145" y="-145" width="1235" height="890" fill="#f8fafc"/>
      ${label(-100,-94,"BRNO / ZATÁČKY 1–9","start",28)}
      ${label(-100,-62,"Jednostranné rozšíření na 2× šířku · strany podle směru jízdy","start",17)}
      <g fill="#e2e8f0">${polygon(g.polygon)}</g>
      <g fill="#99f6e4">${strip("left","baseLeft")}</g>
      <g fill="#bfdbfe">${strip("baseRight","right")}</g>
      <g fill="none" stroke="#0f172a" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">
        <path d="${path(s.map(p=>p.left))}"/><path d="${path(s.map(p=>p.right))}"/>
      </g>
      <g class="original"><path d="${path(g.original)}"/></g>
      <g fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round">${arrows}</g>
      <path d="M ${coord(end.left)} L ${coord(end.right)}" stroke="#64748b" stroke-width="2" stroke-dasharray="6 5"/>
      ${label(959,236,"KONEC ÚSEKU","start",13)}${label(959,257,"za zatáčkou 9","start",13)}
      <path d="M 320,570 L 320,650" stroke="#fff" stroke-width="9"/>
      <path d="M 320,570 L 320,650" stroke="#0f172a" stroke-width="9" stroke-dasharray="10 10"/>
      ${label(343,684,"START","start",15)}
      <g stroke="#334155" stroke-width="1.5"><path d="M 240,570 L 240,650 M 233,576 L 240,570 L 247,576 M 233,644 L 240,650 L 247,644" fill="none"/></g>
      ${label(260,617,"2×","start",17)}
      ${turnMarkup}
      ${callout("Kratší rovinka 2–3",145,288,[270,423])}
      ${callout("Delší rovinka 5–6",749,-5,[653,88])}
      ${callout("Delší rovinka 7–8",649,374,[692,254])}
      <g transform="translate(555 448)">
        ${label(0,0,"KAM SE VOZOVKA ROZŠIŘUJE","start",15)}
        <rect x="0" y="21" width="22" height="16" rx="3" fill="#99f6e4"/>
        ${label(34,35,"Vlevo vně: 1, 2, 4, 5, 6, 9","start",17)}
        <rect x="0" y="57" width="22" height="16" rx="3" fill="#bfdbfe"/>
        ${label(34,71,"Vpravo dovnitř okruhu: 3, 7, 8","start",17)}
        <rect x="0" y="93" width="22" height="16" rx="3" fill="#e2e8f0"/>
        ${label(34,107,"Základní pás šířky 40","start",17)}
        <path d="M 0,139 L 23,139" stroke="#a16207" stroke-width="2" stroke-dasharray="5 4"/>
        ${label(34,144,"Původní stopa před úpravou rovinek","start",15)}
        ${label(0,193,"Nová šířka: 80 · původní: 40","start",18)}
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
