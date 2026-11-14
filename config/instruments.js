/* EasyMeta - facility instrument list (edit me).
 *
 * Files often name a microscope only by a system ID or serial number
 * ("TITAN12345678", D-number 1234, "GLACIOS-1234567").  Each rule below maps
 * text found in the file (system ID, serial, microscope name, camera name) to
 * the name you want people to see.  `match` is a regular expression, tested
 * case-insensitively; the first rule that matches wins.
 *
 * The system IDs and serial numbers below are made up.  Uncomment those lines
 * and put in the IDs of your own instruments.
 */
window.EasyMeta = window.EasyMeta || {};
window.EasyMeta.instrumentRegistry = [
  // { match: /TITAN12345678|\bD1234\b/i, name: 'Titan Krios G4 (D1234)', site: 'Example Facility' },
  // { match: /GLACIOS-?1234567|\b1234567\b/i, name: 'Glacios (1234567)', site: 'Example Facility' },
  // { match: /LSM 980/i, name: 'Zeiss LSM 980 with Airyscan 2 (room B1234)' },
  { match: /2100Plus/i, name: 'JEOL JEM-2100Plus' },
  { match: /Tecnai T12/i, name: 'FEI Tecnai T12' },
];
