/* EasyMeta - peak excitation / emission wavelengths (nm) of common fluorophores,
 * commonly published values written in by hand.  Used only when a file names a
 * dye but does not store its peaks.  No spectra are estimated.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  // name: [excitation peak, emission peak] (a third number, where present, is unused)
  const DYES = {
    dapi: [358, 461, 55], hoechst: [350, 461, 55], 'hoechst33342': [350, 461, 55], 'hoechst33258': [352, 461, 55],
    alexa350: [346, 442], alexa405: [401, 421], pacificblue: [401, 452], bv421: [405, 421], cf405m: [408, 452], atto425: [439, 485],
    bfp: [383, 448], ebfp2: [383, 448], tagbfp: [402, 457], mtagbfp2: [399, 454], coumarin: [350, 445],
    cfp: [433, 475], ecfp: [433, 475], cerulean: [433, 475], mcerulean: [433, 475], mturquoise: [434, 474], mturquoise2: [434, 474],
    gfp: [488, 507], egfp: [488, 507], megfp: [488, 507], emerald: [487, 509], memerald: [487, 509], mneongreen: [506, 517],
    mclover: [505, 515], gcamp: [497, 512], gcamp6: [497, 512], fitc: [495, 519], alexa488: [495, 519], cy2: [489, 506],
    oregongreen: [496, 524], oregongreen488: [496, 524], atto488: [501, 523], dylight488: [493, 518], bodipy: [503, 512], bodipyfl: [503, 512],
    fluo4: [494, 516], calcein: [494, 517], sytoxgreen: [504, 523], sybrgreen: [497, 520], mitotrackergreen: [490, 516], dio: [484, 501],
    dendra2: [490, 507], meos: [506, 519], pagfp: [504, 517],
    yfp: [514, 527], eyfp: [514, 527], venus: [515, 528], mvenus: [515, 528], citrine: [516, 529], mcitrine: [516, 529], alexa514: [517, 542],
    alexa532: [531, 554], cy3: [550, 570], alexa546: [556, 573], alexa555: [555, 565], tritc: [557, 576], rhodamine: [557, 576],
    dylight549: [562, 576], cf568: [562, 583], atto565: [564, 590], dii: [549, 565], jf549: [549, 571], janeliafluor549: [549, 571],
    tdtomato: [554, 581], morange: [548, 562], dsred: [558, 583], mruby: [558, 605], mscarlet: [569, 594], mapple: [568, 592],
    mstrawberry: [574, 596], mcherry: [587, 610], alexa568: [578, 603], alexa594: [590, 617], texasred: [595, 615], dylight594: [593, 618],
    atto594: [601, 627], mkate: [588, 635], mkate2: [588, 633], mplum: [590, 649], propidiumiodide: [535, 617], pi: [535, 617],
    mitotrackerred: [581, 644], lysotrackerred: [577, 590], nilered: [552, 636],
    alexa633: [632, 647], alexa647: [650, 665], cy5: [649, 666], atto647n: [646, 664], jf646: [646, 664], sir: [652, 674],
    dylight649: [654, 673], cf640r: [642, 662], topro3: [642, 661], draq5: [646, 697, 60], atto655: [663, 684],
    alexa660: [663, 690], alexa680: [679, 702], cy55: [675, 694], irfp: [690, 713], alexa700: [702, 723],
    alexa750: [749, 775], cy7: [750, 773],
  };

  function key(name) {
    let k = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[#™®]/g, '');
    k = k.replace(/alexa\s*fluor|alexafluor|\baf(?=\s*\d)/g, 'alexa').replace(/janelia\s*fluor/g, 'jf');
    k = k.replace(/[\s\-_.]+/g, '');
    k = k.replace(/^(anti|phalloidin|wga)/, '');
    return k;
  }
  /** Peaks for a dye name: {ex, em, name} or null. */
  function lookup(name) {
    if (!name) return null;
    const k = key(name);
    if (DYES[k]) return { ex: DYES[k][0], em: DYES[k][1], tail: DYES[k][2], key: k };
    // longest known key contained in the name (e.g. "Phalloidin-Alexa488")
    let best = null;
    for (const d of Object.keys(DYES)) if (d.length >= 3 && k.includes(d) && (!best || d.length > best.length)) best = d;
    return best ? { ex: DYES[best][0], em: DYES[best][1], tail: DYES[best][2], key: best } : null;
  }

  M.dyes = { DYES, lookup, key };
})();
