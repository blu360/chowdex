/**
 * Tiny train icons for the map, drawn on a canvas: a single car with a white upper body, a lower
 * half in the line's color, little windows, and wheels. One facing right and one facing left per
 * line, so a train never has to be drawn upside down when it heads west.
 */

const W = 44;
const H = 30;
const SCALE = 2; // draw at 2x so the icons stay crisp on high-density screens

const BODY = (() => {
  const p = new Path2D();
  p.moveTo(7, 5);
  p.lineTo(28, 5);
  p.quadraticCurveTo(38, 6, 40, 13);
  p.lineTo(41, 19);
  p.quadraticCurveTo(41, 22, 37, 22);
  p.lineTo(7, 22);
  p.quadraticCurveTo(3, 22, 3, 18);
  p.lineTo(3, 9);
  p.quadraticCurveTo(3, 5, 7, 5);
  p.closePath();
  return p;
})();

function drawTrain(color, facingLeft) {
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  if (facingLeft) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Body: white on top, line color below, gray belt line between
  ctx.fillStyle = '#ffffff';
  ctx.fill(BODY);
  ctx.save();
  ctx.clip(BODY);
  ctx.fillStyle = color;
  ctx.fillRect(0, 13, W, 12);
  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 12, W, 1.4);
  ctx.restore();
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 2.4;
  ctx.stroke(BODY);

  // Windows and the windshield
  ctx.fillStyle = '#b3b9bf';
  for (const x of [7, 14.5, 22]) ctx.fillRect(x, 7.2, 6, 4.2);
  ctx.fillStyle = '#9aa6b2';
  ctx.beginPath();
  ctx.moveTo(30, 7.2);
  ctx.lineTo(33, 7.4);
  ctx.quadraticCurveTo(36.5, 9, 37.5, 11.4);
  ctx.lineTo(30, 11.4);
  ctx.closePath();
  ctx.fill();

  // Wheels
  ctx.fillStyle = '#111111';
  for (const x of [11, 31]) {
    ctx.beginPath();
    ctx.arc(x, 24.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  return ctx.getImageData(0, 0, W * SCALE, H * SCALE);
}

/** Adds `train-<line>-r` and `train-<line>-l` images to the map for each line color. */
export function registerTrainIcons(map, lineColors) {
  for (const [line, color] of Object.entries(lineColors)) {
    for (const [suffix, left] of [['r', false], ['l', true]]) {
      const name = `train-${line}-${suffix}`;
      if (!map.hasImage(name)) map.addImage(name, drawTrain(color, left), { pixelRatio: SCALE });
    }
  }
}
