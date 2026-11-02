(function () {
  "use strict";
  const geometry=typeof module!=="undefined" && module.exports
    ? require("../track/brno-circuit.js") : globalThis.BrnoCircuit;
  const {buildGeometry,original,revised,turns}=geometry;
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
