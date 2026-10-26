// 像素画：一帧是一组等长的字符串，一个字符一个像素，字符查调色板得到颜色，`.` 透明。
//
// 不用图片文件：把每一行里同色的连续像素并成一个色块，一帧十几行、每行几块，
// 一个铁匠不到一百个元素，几个铁匠一起动也不费力。改画只要改字符串。

export const WIDTH = 16;
export const HEIGHT = 14;

/** 调色板。像素画的颜色是画本身的一部分，不随主题变。 */
export const PALETTE = {
  k: "#2b2118", // 轮廓、靴子
  h: "#5a3b22", // 头发
  s: "#f0c59a", // 皮肤
  t: "#4f6d8f", // 衣服
  a: "#8a5a32", // 皮围裙
  w: "#a0703c", // 锤柄
  m: "#c4ccd4", // 锤头亮面
  M: "#6b737c", // 锤头、冷铁
  n: "#3d4148", // 铁砧
  o: "#ff7a1a", // 烧红的铁
  y: "#ffd23f", // 火星
  r: "#f2b630", // 铃铛
  z: "#8f96a3", // 打盹的 z
};

const BODY_BOTTOM = [
  "....aaaa........",
  "....k..k.nnnnnn.",
  "...kk..kk..nn...",
  ".........nnnnnn.",
];

/** 打铁：举锤。 */
const HAMMER_UP = [
  "..........MMM...",
  "....hhhh..MmM...",
  "...hhhhhh..w....",
  "...hssssk..w....",
  "...sskssk.w.....",
  "....ssss.s......",
  "...tttttts......",
  "..ttaaaat.......",
  "..s.aaaa........",
  "....aaaa..ooo...",
  ...BODY_BOTTOM,
];

/** 打铁：落锤，火星四溅。 */
const HAMMER_DOWN = [
  "................",
  "....hhhh........",
  "...hhhhhh.......",
  "...hssssk.......",
  "...sskssk.......",
  "....ssss........",
  "...ttttttt......",
  "..ttaaaatsww....",
  "..s.aaaa....w...",
  "....aaaa...MMMy.",
  "....aaaa..yMooMy",
  "....k..k.nnnnnn.",
  "...kk..kk..nn...",
  ".........nnnnnn.",
];

/** 等你：举起铃铛。 */
const BELL_A = [
  ".r..............",
  "rrr.hhhh........",
  "rrrhhhhhh.......",
  ".s.hssssk.......",
  ".s.sskssk.......",
  ".s..ssss........",
  ".sttttttt.......",
  "..ttaaaat.......",
  "....aaaa.s......",
  "....aaaa..MMM...",
  ...BODY_BOTTOM,
];

/** 等你：铃铛晃到另一边。 */
const BELL_B = [
  "..r.............",
  ".rrrhhhh........",
  ".rrhhhhhh.......",
  "..shssssk.......",
  ".s.sskssk.......",
  ".s..ssss........",
  ".sttttttt.......",
  "..ttaaaat.......",
  "....aaaa.s......",
  "....aaaa..MMM...",
  ...BODY_BOTTOM,
];

/** 歇着：闭眼，锤子靠在砧子边。 */
const REST_A = [
  "..........z.....",
  "....hhhh...z....",
  "...hhhhhh.z.....",
  "...hssssk.......",
  "...skkskk.......",
  "....ssss........",
  "...tttttt.......",
  "..ttaaaatt......",
  "..s.aaaa.s......",
  "....aaaa..wMM...",
  ...BODY_BOTTOM,
];

/** 歇着：z 往上飘。 */
const REST_B = [
  "...........z....",
  "....hhhh..z.....",
  "...hhhhhh..z....",
  "...hssssk.......",
  "...skkskk.......",
  "....ssss........",
  "...tttttt.......",
  "..ttaaaatt......",
  "..s.aaaa.s......",
  "....aaaa..wMM...",
  ...BODY_BOTTOM,
];

/** 每种状态两帧，交替播放。 */
export const FRAMES = {
  running: [HAMMER_UP, HAMMER_DOWN],
  needs_you: [BELL_A, BELL_B],
  idle: [REST_A, REST_B],
};

/** 一块铁锭。 */
export const INGOT = [
  ".yyyy.",
  "rrrrrr",
  "oooooo",
];

/**
 * 一行像素并成色块：`[{ color, length }]`，`color` 为 null 是透明。
 * 纯函数，渲染和测试共用。
 */
export function runs(row, palette = PALETTE) {
  const blocks = [];
  for (const pixel of row) {
    const color = pixel === "." ? null : (palette[pixel] ?? null);
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.color === color) last.length += 1;
    else blocks.push({ color, length: 1 });
  }
  return blocks;
}
