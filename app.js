/* global THREE, OrbitControls */
(function () {
  'use strict';

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

  const boot = $('#boot');
  const bootLine = $('#bootLine');
  const errorLayer = $('#error');
  const errorText = $('#errorText');
  const selectionToast = $('#selectionToast');
  const canvas = $('#scene');

  const state = {
    mode: 'detail',
    detailFloor: 0,
    selected: 0,
    exploded: true,
    wire: false,
    autoRotate: true,
    layers: { slabs: true, columns: true, beams: true, cores: true, labels: true },
    hoverFloor: null,
  };

  const COLORS = {
    bg: 0x061116,
    steel: 0xaac3c1,
    steelDark: 0x587376,
    beam: 0x7a999a,
    core: 0x183d43,
    coreEdge: 0x8fc0c2,
    grid: 0x153236,
  };

  // Common structural footprint for 1F–4F:
  // - 3×8-bay wings at both ends (x = ±54…±78)
  // - 15×4-bay central main (x = −54…54, z = −1…32)
  // - 1×7-bay north protrusion (x = −25.2…25.2, z = −9.25…−1)
  // The central area north of the protrusion is open (outdoor plaza at 1F).
  const COMMON_SHAPE = [
    [-78, -34], [-54, -34], [-54, -1], [-25.2, -1], [-25.2, -9.25],
    [25.2, -9.25], [25.2, -1], [54, -1], [54, -34], [78, -34],
    [78, 32], [-78, 32],
  ];

  const FLOOR_DEFS = [
    {
      id: '1F', index: 0, level: 0, storey: 9.2, color: 0x7cb8e8, css: '#7cb8e8',
      short: 'PIPE / CDU', zh: '管件制造 / CDU 管路组装 / 测试',
      en: 'PIPE FABRICATION / CDU PIPE / TEST', note: '高支模 / 重工艺层',
      shape: COMMON_SHAPE,
    },
    {
      id: '2F', index: 1, level: 9.2, storey: 6.4, color: 0x61d7c2, css: '#61d7c2',
      short: 'CDU / LINE', zh: 'CDU 预装 / 自动化总装 / 包装',
      en: 'CDU PREASSEMBLY / LINE / PACK', note: 'CDU 总装与物流层',
      shape: COMMON_SHAPE,
    },
    {
      id: '3F', index: 2, level: 15.6, storey: 6.2, color: 0xefca70, css: '#efca70',
      short: 'ELEC / RACK', zh: '电气 / 机架式 CDU / MF 洁净',
      en: 'ELECTRICAL / RACK CDU / CLEANROOM', note: '电气与洁净生产层',
      shape: COMMON_SHAPE,
    },
    {
      id: '4F', index: 3, level: 21.8, storey: 5.6, color: 0xc8a8ff, css: '#c8a8ff',
      short: 'LAB / R&D', zh: '实验室 / 试制 / 展厅 / 办公 / 培训',
      en: 'LAB / R&D / SHOWROOM / OFFICE', note: 'PDF 复核补入层',
      shape: COMMON_SHAPE,
    },
  ];

  // 23 column lines across: 4 wing / 16 main / 3 wing (shared boundary lines).
  const GRID_X = (() => {
    const xs = [];
    for (let i = 0; i <= 3; i++) xs.push(-78 + i * 8);       // left wing
    for (let i = 0; i <= 15; i++) xs.push(-54 + i * 7.2);    // 15-bay main
    for (let i = 1; i <= 3; i++) xs.push(54 + i * 8);        // right wing
    return [...new Set(xs.map((v) => +v.toFixed(2)))].sort((a, b) => a - b);
  })();

  // 8 full-depth bays; the main uses the southern five lines (4 bays),
  // the protrusion uses the line above it (1 bay).
  const GRID_Z = [-34, -25.75, -17.5, -9.25, -1, 7.25, 15.5, 23.75, 32];

  const CORES = [
    { id: 'W', x: -66, z: -8, w: 8, d: 14 },
    { id: 'E', x: 66, z: -8, w: 8, d: 14 },
  ];

  // 1F visual program zones. Bounding boxes come from the normalized plan
  // interpretation; labels/equipment are deliberately schematic.
  const ONE_F_ZONES = [
    {
      id: '1F-11', title: '园区广场', label: '园区广场',
      bbox: [0.16, 0.04, 0.81, 0.52], kind: 'plaza', labelAt: [-6, -18.5], labelW: 20,
      order: 0, opacity: 0.16, dashed: false, hatch: false,
    },
    {
      id: '1F-01', title: '来料 / 仓储', label: '来料 / 仓储',
      bbox: [0.02, 0.07, 0.14, 0.77], kind: 'raw', labelAt: [-62, 15.2], labelW: 13,
      order: 1, opacity: 0.16,
    },
    {
      id: '1F-02', title: '物流周转', label: '',
      bbox: [0.15, 0.66, 0.22, 0.80], kind: 'raw', labelAt: null, labelW: 0,
      order: 1, opacity: 0.12,
    },
    {
      id: '1F-04/05', title: '下料 / 成型 / 焊接', label: '下料 / 成型 / 焊接',
      bbox: [0.16, 0.56, 0.35, 0.80], kind: 'weld', labelAt: [-38, 19.4], labelW: 16,
      order: 2, opacity: 0.15,
    },
    {
      id: '1F-03', title: '第5行 全自动线', label: '第5行整线 / 待确认',
      bbox: [0.19, 0.49, 0.60, 0.61], kind: 'line', labelAt: [-18, 0.6], labelW: 15,
      order: 3, opacity: 0.06, dashed: true,
    },
    {
      id: '1F-06', title: 'CDU 管路组装', label: 'CDU 组装 / 40+ 工位',
      bbox: [0.35, 0.66, 0.67, 0.97], kind: 'cdu', labelAt: [0, 30.6], labelW: 18,
      order: 3, opacity: 0.13,
    },
    {
      id: '1F-07', title: '表面处理', label: '表面处理',
      bbox: [0.65, 0.54, 0.79, 0.70], kind: 'surface', labelAt: [34, 12.4], labelW: 10.5,
      order: 4, opacity: 0.19,
    },
    {
      id: '1F-08', title: '二次侧环网', label: '',
      bbox: [0.65, 0.70, 0.79, 0.83], kind: 'ring', labelAt: null, labelW: 0,
      order: 5, opacity: 0.13,
    },
    {
      id: '1F-09', title: '管路预装', label: '环网 / 预装',
      bbox: [0.79, 0.54, 0.98, 0.85], kind: 'ring', labelAt: [60, 22.6], labelW: 15,
      order: 5, opacity: 0.13,
    },
    {
      id: '1F-10', title: '实验室', label: '实验室',
      bbox: [0.84, 0.11, 1.00, 0.51], kind: 'lab', labelAt: [66, -23.6], labelW: 9.5,
      order: 5, opacity: 0.15,
    },
    {
      id: '1F-12', title: '线边原料缓存', label: '',
      bbox: [0.60, 0.52, 0.67, 0.83], kind: 'lineside', labelAt: null, labelW: 0,
      order: 6, opacity: 0.08, dashed: true,
    },
  ];

  const DETAIL_COLORS = {
    raw: 0xa8af67,
    weld: 0x4f9daa,
    cdu: 0x6287c0,
    surface: 0xc18a4b,
    ring: 0x5e9fa2,
    lab: 0xc6aa69,
    reserved: 0x897f70,
    line: 0x6e9f8b,
    lineside: 0x8a9b74,
    pack: 0x6f9d84,
    shipping: 0x8a9b70,
    preassembly: 0x5d9fa0,
    office: 0x7d7f95,
    support: 0x6f7f85,
    elec: 0x8f7bc0,
    clean: 0x4f9c78,
    warehouse: 0x7b8a55,
    logistics: 0x879479,
    trial: 0xb18a5e,
    showroom: 0xb2874c,
    meeting: 0x99836b,
    auditorium: 0x9a7d63,
    training: 0x9b8d6d,
    assembly: 0x5c8f9c,
    plaza: 0x7f9c84,
  };

  const DETAIL_X_MIN = -79;
  const DETAIL_X_SPAN = 158;
  const DETAIL_Z_MIN = -35;
  const DETAIL_Z_SPAN = 70;

  const TWO_F_ZONES = [
    {
      id: '2F-02', title: '成品周转', label: '', bbox: [0.0063, 0.0286, 0.1582, 0.7286],
      kind: 'storage', order: 0, opacity: 0.10,
    },
    {
      id: '2F-01', title: '成品包装 / 发货', label: '包装 2线 / 发货',
      bbox: [0.0443, 0.0571, 0.1582, 0.4429], kind: 'pack', labelAt: [-63, -18],
      order: 1, opacity: 0.16,
    },
    {
      id: '2F-03', title: '发货周转', label: '', bbox: [0.0190, 0.7286, 0.1582, 0.9429],
      kind: 'shipping', order: 1, opacity: 0.15,
    },
    {
      id: '2F-04', title: 'CDU总装自动化线', label: 'CDU总装自动化线',
      bbox: [0.1709, 0.4857, 0.7025, 0.7214], kind: 'line', labelAt: [-10, 7.25],
      order: 2, opacity: 0.14,
    },
    {
      id: '2F-05', title: '大CDU线/小CDU线', label: '大CDU线/小CDU线',
      bbox: [0.1709, 0.7214, 0.7025, 0.9571], kind: 'reserved', labelAt: [-10, 23.5],
      order: 0, opacity: 0.06, dashed: true,
    },
    {
      id: '2F-07', title: '产品预装（北/南）', label: '预装 5类 × 2线',
      bbox: [0.72, 0.54, 0.84, 0.72], kind: 'preassembly', labelAt: [44, 12],
      order: 2, opacity: 0.15,
    },
    {
      id: '2F-08', title: '产品预装（南）', label: '', bbox: [0.72, 0.72, 0.84, 0.94],
      kind: 'preassembly', order: 2, opacity: 0.15,
    },
    {
      id: '2F-09', title: '半成品周转', label: '半成品周转',
      bbox: [0.8418, 0.0286, 1.0000, 0.9429], kind: 'storage', labelAt: [69, 6],
      order: 1, opacity: 0.09,
    },
    {
      id: '2F-10', title: '办公 / 会议 / 休闲', label: '办公 / 会议',
      bbox: [0.3405, 0.3686, 0.6595, 0.4857], kind: 'office', labelAt: [-1, -5],
      order: 2, opacity: 0.11,
    },
  ];

  const THREE_F_ZONES = [
    {
      id: '3F-01', title: '电气装配 / 电气测试', label: '电气装配 / 测试',
      bbox: [0.01, 0.03, 0.16, 0.54], kind: 'elec', labelAt: [-65, -14],
      order: 2, opacity: 0.15,
    },
    {
      id: '3F-02', title: 'CDU 样件制作', label: '', bbox: [0.01, 0.54, 0.16, 0.64],
      kind: 'trial', order: 2, opacity: 0.11,
    },
    {
      id: '3F-03', title: '机架式 CDU 线 2', label: '机架式 CDU 线 1/2',
      bbox: [0.01, 0.64, 0.16, 0.72], kind: 'line', labelAt: [-65, 16],
      order: 3, opacity: 0.14,
    },
    {
      id: '3F-04', title: '机架式 CDU 线 1', label: '', bbox: [0.01, 0.72, 0.16, 0.81],
      kind: 'line', order: 3, opacity: 0.14,
    },
    {
      id: '3F-05', title: '成品暂放（西）', label: '成品暂放·西',
      bbox: [0.08, 0.81, 0.16, 0.97], kind: 'storage', labelAt: [-60, 27],
      order: 2, opacity: 0.12,
    },
    {
      id: '3F-06', title: '物料拆包（西）', label: '拆包 / 分拣',
      bbox: [0.16, 0.48, 0.22, 0.59], kind: 'logistics', labelAt: [-48, 3],
      order: 1, opacity: 0.10,
    },
    {
      id: '3F-07', title: '物料分拣（西）', label: '', bbox: [0.16, 0.59, 0.22, 0.84],
      kind: 'logistics', order: 1, opacity: 0.10,
    },
    {
      id: '3F-08', title: '零部件仓储', label: '零部件仓储',
      bbox: [0.26, 0.52, 0.66, 0.90], kind: 'warehouse', labelAt: [-6, 15],
      order: 1, opacity: 0.12,
    },
    {
      id: '3F-09', title: '电气物料仓储', label: '电气物料',
      bbox: [0.66, 0.52, 0.89, 0.90], kind: 'warehouse', labelAt: [44, 15],
      order: 1, opacity: 0.12,
    },
    {
      id: '3F-10', title: 'MF 洁净车间', label: 'MF 洁净车间',
      bbox: [0.85, 0.06, 0.98, 0.46], kind: 'clean', labelAt: [65, -18],
      order: 3, opacity: 0.16,
    },
    {
      id: '3F-11', title: '分水器组装', label: '分水器组装',
      bbox: [0.85, 0.43, 0.93, 0.57], kind: 'assembly', labelAt: [61, 0],
      order: 3, opacity: 0.15,
    },
    {
      id: '3F-12', title: '物料暂放（东北）', label: '', bbox: [0.92, 0.17, 0.98, 0.46],
      kind: 'storage', order: 2, opacity: 0.10,
    },
    {
      id: '3F-13', title: '物料暂放（东南）', label: '', bbox: [0.85, 0.61, 0.96, 0.84],
      kind: 'storage', order: 2, opacity: 0.10,
    },
    {
      id: '3F-14', title: '成品暂放（东）', label: '成品暂放·东',
      bbox: [0.87, 0.84, 0.98, 0.97], kind: 'storage', labelAt: [67, 28],
      order: 2, opacity: 0.12,
    },
    {
      id: '3F-15', title: '物料拆包 / 分拣（东）', label: '', bbox: [0.89, 0.48, 0.94, 0.84],
      kind: 'logistics', order: 2, opacity: 0.09,
    },
  ];

  const FOUR_F_ZONES = [
    {
      id: '4F-01', title: '实验室 2', label: '实验室 2',
      bbox: [0.0000, 0.0000, 0.1707, 0.3908], kind: 'lab', labelAt: [-65, -20],
      order: 1, opacity: 0.14,
    },
    {
      id: '4F-02', title: '试制车间', label: '试制车间',
      bbox: [0.0000, 0.3908, 0.1707, 0.7471], kind: 'trial', labelAt: [-65, 5],
      order: 2, opacity: 0.15,
    },
    {
      id: '4F-03', title: '成品暂放', label: '',
      bbox: [0.0732, 0.7471, 0.1707, 0.9310], kind: 'storage', labelAt: null,
      order: 1, opacity: 0.10,
    },
    {
      id: '4F-04', title: '实验室 1', label: '实验室 1',
      bbox: [0.1951, 0.4023, 0.4024, 0.9310], kind: 'lab', labelAt: [-32, 12],
      order: 2, opacity: 0.14,
    },
    {
      id: '4F-05', title: '展厅', label: '展厅',
      bbox: [0.4024, 0.3908, 0.5366, 0.7471], kind: 'showroom', labelAt: [-5, 5],
      order: 2, opacity: 0.15,
    },
    {
      id: '4F-06', title: '展厅会议室', label: '展厅会议',
      bbox: [0.4024, 0.7471, 0.5366, 0.9310], kind: 'meeting', labelAt: [-5, 24],
      order: 2, opacity: 0.13,
    },
    {
      id: '4F-07', title: '综合办公区', label: '综合办公',
      bbox: [0.5610, 0.3333, 0.8537, 0.7011], kind: 'office', labelAt: [33, 1],
      order: 2, opacity: 0.10,
    },
    {
      id: '4F-08', title: '报告厅', label: '报告厅',
      bbox: [0.8659, 0.0575, 1.0000, 0.4368], kind: 'auditorium', labelAt: [68, -18],
      order: 3, opacity: 0.15,
    },
    {
      id: '4F-09', title: '技能训练场', label: '技能训练',
      bbox: [0.8659, 0.4368, 1.0000, 0.6322], kind: 'training', labelAt: [68, 2],
      order: 3, opacity: 0.14,
    },
    {
      id: '4F-10', title: '培训中心', label: '培训中心',
      bbox: [0.8659, 0.6322, 1.0000, 1.0000], kind: 'training', labelAt: [68, 22],
      order: 3, opacity: 0.14,
    },
  ];

  const FRAME_VIEWS = {
    iso: { pos: [-168, 110, 186], target: [8, 14, 0] },
    front: { pos: [8, 58, 292], target: [8, 14, 0] },
    side: { pos: [292, 58, 0], target: [0, 14, 0] },
    top: { pos: [8, 315, 0.2], target: [8, 12, 0] },
  };

  const DETAIL_META = [
    {
      id: '1F', modeLabel: '工艺布局', title: '1F 工艺布局',
      subtitle: '管件制造 · CDU 管路组装 · 表面处理 · 测试',
      rows: 31, zones: 13,
      chip: '<b>1F</b> · 设备/机位体块示意',
      note: '<b>1F 工艺布局</b> · 31 条清单 · 13 个图纸分区；设备与机位为体块示意。1F-11 为北侧开敞园区广场（非生产区），CDU 工位数量以图纸/设备确认版为准。',
    },
    {
      id: '2F', modeLabel: '工艺布局', title: '2F 工艺布局',
      subtitle: 'CDU 预装 · 自动化总装 · EOL 测试 · 包装发货',
      rows: 9, zones: 10,
      chip: '<b>2F</b> · 悬停设备 / 未落位2类',
      note: '<b>2F 设备级：</b>12工位总装线·预装5类×2线·包装2线；悬停看名称。2F-04/05 分占主楼上下半区，2F-10 办公会议已移入北侧1×7凸出结构；手动线1 + EOL4 未落位。',
    },
    {
      id: '3F', modeLabel: '工艺布局', title: '3F 工艺布局',
      subtitle: '电气 · 机架式 CDU · MF 洁净 · 中央仓储',
      rows: 16, zones: 16,
      chip: '<b>3F</b> · 2条线 vs 清单1套',
      note: '<b>3F 工艺布局</b> · 图纸为 2 条机架式 CDU 线，清单按 1 套记录；MF 洁净/组装/氦检顺序与洁净等级待确认。',
    },
    {
      id: '4F', modeLabel: '功能布局', title: '4F 功能布局',
      subtitle: '实验室 · 研发试制 · 展厅 · 办公培训',
      rows: 35, zones: 11,
      chip: '<b>4F</b> · 功能体块 / 非机位',
      note: '<b>4F 功能布局</b> · 4F 分区按图纸/结构化数据补齐；实验室、研发、试制、展厅、办公与培训设备为功能体块示意，具体机位待深化。',
    },
  ];

  const FRAME_COPY = {
    title: '建筑主体框架',
    subtitle: '四层统一结构 · 主楼 15×4 · 两翼 3×8 · 北侧 1×7 凸出',
    eyebrow: 'PLANT 01 / STRUCTURAL BLOCKOUT',
    documentTitle: '1号厂房 / 建筑主体框架 / Structural Blockout',
  };

  const SLAB_T = 0.55;
  const EXPLODE_RISE = 2.45;
  const ROOF_LEVEL = 27.4;

  let renderer;
  let scene;
  let camera;
  let controls;
  let clock;
  let raycaster;
  let pointer;
  let downPoint = null;
  let downTime = 0;
  let cameraAnim = null;
  let explosion = 1;
  let explosionTarget = 1;
  let lastTime = 0;

  const floorGroups = [];
  const slabMeshes = [];
  const fadeSets = [];
  const solidMeshes = [];
  const zoneTagSets = new Map();
  const detailLayers = [];
  const twoFPickables = [];

  function fail(message) {
    if (errorLayer) {
      errorLayer.hidden = false;
      if (errorText) errorText.textContent = message || '场景启动失败。';
    }
    if (boot) boot.classList.add('done');
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function makeShape(points) {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => {
      const y = -z;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    return shape;
  }

  function pointOnSegment(x, z, ax, az, bx, bz, eps = 1e-7) {
    const cross = (x - ax) * (bz - az) - (z - az) * (bx - ax);
    if (Math.abs(cross) > eps) return false;
    const dot = (x - ax) * (bx - ax) + (z - az) * (bz - az);
    const len2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
    return dot >= -eps && dot <= len2 + eps;
  }

  function pointInPolygon(x, z, points) {
    // Include points that lie exactly on the footprint boundary; otherwise
    // the outer column rows/edge columns disappear at the slab edge.
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      if (pointOnSegment(x, z, points[j][0], points[j][1], points[i][0], points[i][1])) {
        return true;
      }
    }
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0];
      const zi = points[i][1];
      const xj = points[j][0];
      const zj = points[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }

  function insideCore(x, z, padding = 1.2) {
    return CORES.some((core) =>
      Math.abs(x - core.x) < core.w / 2 + padding &&
      Math.abs(z - core.z) < core.d / 2 + padding
    );
  }

  function makeGridValues(min, max, step) {
    const values = [];
    for (let value = min; value <= max + 0.001; value += step) values.push(Number(value.toFixed(3)));
    return values;
  }

  function rgba(hex, alpha) {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
  }

  function makeFloorLabelTexture(floor) {
    const scale = 2;
    const w = 500;
    const h = 190;
    const c = document.createElement('canvas');
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(4,16,19,0.93)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = rgba(floor.css, 0.62);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.fillStyle = floor.css;
    ctx.fillRect(0, 0, 7, h);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(7, 0, 2, h);
    ctx.globalAlpha = 1;

    ctx.fillStyle = floor.css;
    ctx.font = '600 110px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.fillText(floor.id, 22, 119);

    ctx.fillStyle = 'rgba(230,244,239,0.9)';
    ctx.font = '500 44px "Cascadia Code", Consolas, monospace';
    ctx.fillText(floor.short, 158, 78);

    ctx.fillStyle = 'rgba(151,176,172,0.7)';
    ctx.font = '400 18px "Cascadia Code", Consolas, monospace';
    ctx.fillText(floor.index === 3 ? 'PDF RECONCILED / LEVEL 04' : `LEVEL 0${floor.index + 1}`, 160, 112);

    ctx.fillStyle = 'rgba(151,176,172,0.44)';
    ctx.font = '400 16px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText('结构示意 / 非施工图', 160, 144);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function makeFloorLabel(floor) {
    const texture = makeFloorLabelTexture(floor);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(15.2, 5.78, 1);
    sprite.center.set(1, 0.5);
    sprite.position.set(-98, 2.9, 0);
    sprite.renderOrder = 50;
    sprite.userData.isLabel = true;
    return sprite;
  }

  function registerFade(floor, material, baseOpacity, noDepthWrite = false) {
    material.transparent = true;
    material.opacity = baseOpacity;
    fadeSets.push({ floor, material, baseOpacity, noDepthWrite });
  }

  function makeSteelMaterial(color = COLORS.steel) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.45,
      roughness: 0.42,
      emissive: 0x102a2e,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.94,
    });
  }

  function addBeamBetween(group, x1, z1, x2, z2, y, height, width, material, options = {}) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return null;
    const geometry = new THREE.BoxGeometry(length, height, width);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function buildSite(root) {
    const site = new THREE.Group();
    root.add(site);

    // Soft radial ground disc: gives a horizon and receives structural shadows.
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = 1024;
    alphaCanvas.height = 1024;
    const a = alphaCanvas.getContext('2d');
    const alphaGrad = a.createRadialGradient(512, 512, 30, 512, 512, 490);
    alphaGrad.addColorStop(0, 'rgba(255,255,255,1)');
    alphaGrad.addColorStop(0.56, 'rgba(255,255,255,0.72)');
    alphaGrad.addColorStop(0.82, 'rgba(255,255,255,0.18)');
    alphaGrad.addColorStop(1, 'rgba(255,255,255,0)');
    a.fillStyle = alphaGrad;
    a.fillRect(0, 0, 1024, 1024);
    const alphaTex = new THREE.CanvasTexture(alphaCanvas);
    alphaTex.colorSpace = THREE.NoColorSpace;

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x081a1d,
      roughness: 0.93,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
      alphaMap: alphaTex,
      depthWrite: false,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.08;
    ground.receiveShadow = true;
    site.add(ground);

    const grid = new THREE.GridHelper(430, 43, 0x245151, 0x163337);
    grid.position.y = -1.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.material.depthWrite = false;
    site.add(grid);

    const ringPoints = [];
    for (let i = 0; i <= 160; i++) {
      const angle = (i / 160) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(angle) * 144, -0.98, Math.sin(angle) * 144));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({ color: 0x356b6d, transparent: true, opacity: 0.22, depthWrite: false })
    );
    site.add(ring);

    // Axis lines on the site grid.
    const axisMat = new THREE.LineBasicMaterial({
      color: 0x3e7172,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-210, -0.99, 0), new THREE.Vector3(210, -0.99, 0),
      new THREE.Vector3(0, -0.99, -210), new THREE.Vector3(0, -0.99, 210),
    ]);
    site.add(new THREE.LineSegments(axisGeo, axisMat));

    // Dashed vertical guides preserve the four-level datum in exploded mode.
    const guideMat = new THREE.LineDashedMaterial({
      color: 0x4e8687,
      dashSize: 2.0,
      gapSize: 2.4,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const cornerPoints = [[-78, -34], [78, -34], [-78, 32], [78, 32]];
    cornerPoints.forEach(([x, z]) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, -1, z),
        new THREE.Vector3(x, ROOF_LEVEL + EXPLODE_RISE * 3 + 6, z),
      ]);
      const line = new THREE.Line(geo, guideMat);
      line.computeLineDistances();
      site.add(line);
    });

    // North marker on the ground, intentionally just outside the site focus.
    const northGroup = new THREE.Group();
    northGroup.position.set(-116, -0.92, 48);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, -8);
    arrowShape.lineTo(4, 2);
    arrowShape.lineTo(0, 0);
    arrowShape.lineTo(-4, 2);
    arrowShape.closePath();
    const arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(arrowShape),
      new THREE.MeshBasicMaterial({ color: 0x6be1d2, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    arrow.rotation.x = -Math.PI / 2;
    northGroup.add(arrow);
    const northLabelCanvas = document.createElement('canvas');
    northLabelCanvas.width = 96;
    northLabelCanvas.height = 96;
    const nl = northLabelCanvas.getContext('2d');
    nl.fillStyle = 'rgba(107,225,210,0.82)';
    nl.font = '600 56px "Cascadia Code", Consolas, monospace';
    nl.textAlign = 'center';
    nl.textBaseline = 'middle';
    nl.fillText('N', 48, 48);
    const northTex = new THREE.CanvasTexture(northLabelCanvas);
    northTex.colorSpace = THREE.SRGBColorSpace;
    const northSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: northTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.78,
    }));
    northSprite.scale.set(4, 4, 1);
    northSprite.position.set(0, 5.5, 7);
    northGroup.add(northSprite);
    site.add(northGroup);

    return site;
  }

  function buildSlab(floor, group) {
    const shape = makeShape(floor.shape);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB_T,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    const slabMaterial = new THREE.MeshPhysicalMaterial({
      color: floor.color,
      metalness: 0.22,
      roughness: 0.38,
      clearcoat: 0.5,
      clearcoatRoughness: 0.28,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      emissive: floor.color,
      emissiveIntensity: 0.055,
    });
    registerFade(floor, slabMaterial, 0.16, true);

    const slab = new THREE.Mesh(geometry, slabMaterial);
    slab.renderOrder = 5;
    slab.userData.floorIndex = floor.index;
    slab.userData.solid = true;
    slab.castShadow = false;
    slab.receiveShadow = true;
    group.add(slab);
    floor.slabMesh = slab;
    slabMeshes.push(slab);
    solidMeshes.push(slab);

    const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: floor.color,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    registerFade(floor, edgeMaterial, 0.58, true);
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.renderOrder = 6;
    group.add(edgeLines);

    const perimeterPoints = floor.shape.map(([x, z]) => new THREE.Vector3(x, SLAB_T + 0.025, z));
    const perimeterMaterial = new THREE.LineBasicMaterial({
      color: floor.color,
      transparent: true,
      opacity: 0.90,
      depthWrite: false,
    });
    registerFade(floor, perimeterMaterial, 0.90, true);
    const perimeter = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(perimeterPoints),
      perimeterMaterial
    );
    perimeter.renderOrder = 7;
    group.add(perimeter);

    return slab;
  }

  function buildEdgeBeams(floor, group) {
    const beamMaterial = makeSteelMaterial(COLORS.beam);
    beamMaterial.opacity = 0.88;
    registerFade(floor, beamMaterial, 0.88, false);

    floor.shape.forEach(([x1, z1], i) => {
      const [x2, z2] = floor.shape[(i + 1) % floor.shape.length];
      const beam = addBeamBetween(group, x1, z1, x2, z2, 0.09, 0.60, 0.34, beamMaterial);
      if (beam) {
        beam.userData.solid = true;
        solidMeshes.push(beam);
      }
    });

    return beamMaterial;
  }

  function buildColumns(floor, group) {
    // The same 23×9 structural column grid is used on all four floors.
    const points = [];
    GRID_X.forEach((x) => {
      GRID_Z.forEach((z) => {
        if (!pointInPolygon(x, z, floor.shape)) return;
        points.push([x, z]);
      });
    });

    const height = floor.storey - SLAB_T - 0.15;
    const columnGeometry = new THREE.BoxGeometry(0.68, 1, 0.68);
    columnGeometry.translate(0, 0.5, 0);
    const columnMaterial = makeSteelMaterial(0xc1d5d1);
    columnMaterial.opacity = 0.95;
    registerFade(floor, columnMaterial, 0.95, false);

    const columns = new THREE.InstancedMesh(columnGeometry, columnMaterial, points.length);
    columns.castShadow = true;
    columns.receiveShadow = true;
    columns.frustumCulled = false;
    columns.userData.solid = true;

    const capitalGeometry = new THREE.BoxGeometry(1.18, 0.12, 1.18);
    const capitalMaterial = new THREE.MeshStandardMaterial({
      color: 0x789796,
      metalness: 0.38,
      roughness: 0.48,
      transparent: true,
      opacity: 0.92,
    });
    registerFade(floor, capitalMaterial, 0.92, false);
    const capitals = new THREE.InstancedMesh(capitalGeometry, capitalMaterial, points.length);
    capitals.castShadow = true;
    capitals.receiveShadow = true;
    capitals.frustumCulled = false;
    capitals.userData.solid = true;

    const dummy = new THREE.Object3D();
    points.forEach(([x, z], i) => {
      dummy.position.set(x, SLAB_T, z);
      dummy.scale.set(1, height, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      columns.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, SLAB_T + height - 0.06, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      capitals.setMatrixAt(i, dummy.matrix);
    });
    columns.instanceMatrix.needsUpdate = true;
    capitals.instanceMatrix.needsUpdate = true;

    group.add(columns);
    group.add(capitals);
    solidMeshes.push(columns, capitals);
    floor.columnPoints = points;
  }

  function buildCores(floor, group) {
    const coreBodyMaterial = new THREE.MeshPhysicalMaterial({
      color: COLORS.core,
      metalness: 0.48,
      roughness: 0.30,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      emissive: 0x0b2428,
      emissiveIntensity: 0.4,
    });
    registerFade(floor, coreBodyMaterial, 0.56, true);

    const coreEdgeMaterial = new THREE.LineBasicMaterial({
      color: COLORS.coreEdge,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    registerFade(floor, coreEdgeMaterial, 0.52, true);

    const braceMaterial = new THREE.LineBasicMaterial({
      color: 0xa9d3cf,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    registerFade(floor, braceMaterial, 0.34, true);

    const height = floor.storey - SLAB_T - 0.22;
    CORES.forEach((core) => {
      const geometry = new THREE.BoxGeometry(core.w, height, core.d);
      const body = new THREE.Mesh(geometry, coreBodyMaterial);
      body.position.set(core.x, SLAB_T + height / 2, core.z);
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.solid = true;
      group.add(body);
      solidMeshes.push(body);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        coreEdgeMaterial
      );
      edges.position.copy(body.position);
      group.add(edges);

      const y0 = SLAB_T + 0.6;
      const y1 = SLAB_T + height - 0.6;
      const zf = core.z + core.d / 2 + 0.035;
      const zb = core.z - core.d / 2 - 0.035;
      const x0 = core.x - core.w / 2 + 0.45;
      const x1 = core.x + core.w / 2 - 0.45;
      const points = [];
      [zf, zb].forEach((zface) => {
        points.push(
          new THREE.Vector3(x0, y0, zface), new THREE.Vector3(x1, y1, zface),
          new THREE.Vector3(x0, y1, zface), new THREE.Vector3(x1, y0, zface)
        );
      });
      const braces = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        braceMaterial
      );
      group.add(braces);
    });
  }

  function buildRoof(floor, group) {
    const roofMaterial = makeSteelMaterial(0x9eb7b4);
    roofMaterial.opacity = 0.62;
    registerFade(floor, roofMaterial, 0.62, false);

    const y = floor.storey - 0.2;
    floor.shape.forEach(([x1, z1], i) => {
      const [x2, z2] = floor.shape[(i + 1) % floor.shape.length];
      addBeamBetween(group, x1, z1, x2, z2, y, 0.32, 0.20, roofMaterial);
    });

    const roofGridMaterial = new THREE.LineBasicMaterial({
      color: 0x86a5a3,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
    });
    registerFade(floor, roofGridMaterial, 0.20, true);
    const lines = [];
    [-54, -27, 0, 27, 54].forEach((x) => {
      lines.push(new THREE.Vector3(x, y + 0.18, -17), new THREE.Vector3(x, y + 0.18, 32));
    });
    [-17, 5, 21, 32].forEach((z) => {
      lines.push(new THREE.Vector3(-54, y + 0.18, z), new THREE.Vector3(54, y + 0.18, z));
    });
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), roofGridMaterial));

    const parapetMaterial = new THREE.LineBasicMaterial({
      color: 0x9cbab6,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    registerFade(floor, parapetMaterial, 0.44, true);
    const roofLine = floor.shape.map(([x, z]) => new THREE.Vector3(x, y + 0.55, z));
    group.add(new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(roofLine),
      parapetMaterial
    ));

    const roofLabelTexture = makeSimpleLabelTexture('ROOF', '屋面 / TOP', 'rgba(7,24,27,0.84)', '#a9d3cf');
    const roofLabelMat = new THREE.SpriteMaterial({
      map: roofLabelTexture, transparent: true, depthTest: false, depthWrite: false, opacity: 0,
    });
    const roofLabel = new THREE.Sprite(roofLabelMat);
    roofLabel.scale.set(7.3, 2.35, 1);
    roofLabel.position.set(-82.5, y + 2.25, 0);
    roofLabel.center.set(1, 0.5);
    roofLabel.renderOrder = 51;
    registerFade(floor, roofLabelMat, 0, true);
    floor.roofLabel = roofLabel;
    group.add(roofLabel);
  }

  function makeSimpleLabelTexture(title, sub, bg, accent) {
    const s = 2;
    const w = 360;
    const h = 112;
    const c = document.createElement('canvas');
    c.width = w * s;
    c.height = h * s;
    const ctx = c.getContext('2d');
    ctx.scale(s, s);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 5, h);
    ctx.font = '600 34px "Cascadia Code", Consolas, monospace';
    ctx.fillText(title, 19, 48);
    ctx.fillStyle = 'rgba(195,219,214,0.66)';
    ctx.font = '400 18px "Microsoft YaHei", sans-serif';
    ctx.fillText(sub, 19, 78);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -------------------------------------------------------------------------
  // 1F process layout: zones, representative equipment massing, flat labels.
  // -------------------------------------------------------------------------
  function detailX(nx) {
    return DETAIL_X_MIN + nx * DETAIL_X_SPAN;
  }

  function detailZ(ny) {
    return DETAIL_Z_MIN + ny * DETAIL_Z_SPAN;
  }

  function makeZoneLabelTexture(zone) {
    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 192;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(4,16,19,0.92)';
    ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = rgba(`#${new THREE.Color(DETAIL_COLORS[zone.kind] || 0x899a9d).getHexString()}`, 0.55);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 766, 190);
    ctx.fillStyle = `#${new THREE.Color(DETAIL_COLORS[zone.kind] || 0x899a9d).getHexString()}`;
    ctx.fillRect(0, 0, 10, 192);

    ctx.fillStyle = 'rgba(155,180,175,0.72)';
    ctx.font = '500 19px "Cascadia Code", Consolas, monospace';
    ctx.fillText(zone.id, 28, 39);

    let size = 49;
    ctx.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    while (ctx.measureText(zone.label).width > 700 && size > 28) {
      size -= 2;
      ctx.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    }
    ctx.fillStyle = 'rgba(236,246,242,0.94)';
    ctx.fillText(zone.label, 28, 120);

    ctx.fillStyle = 'rgba(143,164,163,0.55)';
    ctx.font = '500 14px "Cascadia Code", Consolas, monospace';
    ctx.fillText('1F / PROCESS LAYOUT', 28, 157);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  function makeHatchTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(195,183,160,0.62)';
    ctx.lineWidth = 2;
    for (let i = -64; i < 128; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - 64, 64);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function addZoneLabel(group, zone) {
    if (!zone.label || !zone.labelAt) return;
    const tex = makeZoneLabelTexture(zone);
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const width = zone.labelW;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(zone.labelAt[0], SLAB_T + 0.17 + zone.order * 0.002, zone.labelAt[1]);
    mesh.renderOrder = 25;
    group.add(mesh);
  }

  function addZonePatch(zone, group, labelGroup) {
    const x1 = detailX(zone.bbox[0]);
    const x2 = detailX(zone.bbox[2]);
    const z1 = detailZ(zone.bbox[1]);
    const z2 = detailZ(zone.bbox[3]);
    const w = x2 - x1;
    const d = z2 - z1;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const color = DETAIL_COLORS[zone.kind] || 0x899a9d;
    const y = SLAB_T + 0.035 + zone.order * 0.0025;

    let material;
    if (zone.hatch) {
      const tex = makeHatchTexture();
      tex.repeat.set(Math.max(2, w / 7), Math.max(2, d / 7));
      material = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: zone.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, y, cz);
    plane.renderOrder = 3;
    group.add(plane);

    const boundaryPoints = [
      new THREE.Vector3(x1, y + 0.01, z1),
      new THREE.Vector3(x2, y + 0.01, z1),
      new THREE.Vector3(x2, y + 0.01, z2),
      new THREE.Vector3(x1, y + 0.01, z2),
      new THREE.Vector3(x1, y + 0.01, z1),
    ];
    const borderColor = zone.kind === 'reserved' ? 0xd0b36f : color;
    let border;
    if (zone.dashed) {
      border = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(boundaryPoints),
        new THREE.LineDashedMaterial({
          color: borderColor,
          dashSize: 2.0,
          gapSize: 1.2,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        })
      );
      border.computeLineDistances();
    } else {
      border = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(boundaryPoints),
        new THREE.LineBasicMaterial({
          color: borderColor,
          transparent: true,
          opacity: 0.64,
          depthWrite: false,
        })
      );
    }
    border.renderOrder = 4;
    group.add(border);

    // The integrated automatic line is a linear process, not a filled zone.
    // A dashed centerline makes that distinction visible without modelling
    // a second, potentially duplicate line.
    if (zone.id === '1F-03') {
      const routeY = y + 0.025;
      const route = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x1 + 1.5, routeY, cz),
          new THREE.Vector3(x2 - 1.5, routeY, cz),
        ]),
        new THREE.LineDashedMaterial({
          color: 0x7edbd4,
          dashSize: 2.0,
          gapSize: 2.2,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      route.computeLineDistances();
      route.renderOrder = 6;
      group.add(route);

      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 3, 1.2),
        new THREE.MeshBasicMaterial({
          color: 0x4c9aa7,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(cx, routeY - 0.004, cz);
      band.renderOrder = 5;
      group.add(band);

      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 1.0, 8),
        new THREE.MeshBasicMaterial({ color: 0x7edbd4, transparent: true, opacity: 0.82 })
      );
      arrow.position.set(x2 - 2.0, routeY + 0.4, cz);
      arrow.rotation.z = -Math.PI / 2;
      arrow.renderOrder = 7;
      group.add(arrow);
    }
  }

  function zoneRect(zone) {
    const [a, b, c, d] = zone.bbox;
    const x1 = detailX(a);
    const x2 = detailX(c);
    const z1 = detailZ(b);
    const z2 = detailZ(d);
    return {
      x1, x2, z1, z2,
      cx: (x1 + x2) / 2,
      cz: (z1 + z2) / 2,
      w: x2 - x1,
      d: z2 - z1,
    };
  }

  const detailMaterials = new Map();
  function getDetailMaterial(color, opacity = 1, glass = false, ghost = false) {
    const key = `${color}-${opacity}-${glass}-${ghost}`;
    if (detailMaterials.has(key)) return detailMaterials.get(key);
    let material;
    if (glass) {
      material = new THREE.MeshPhysicalMaterial({
        color,
        transparent: true,
        opacity: opacity || 0.16,
        roughness: 0.16,
        metalness: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        color,
        transparent: opacity < 1 || ghost,
        opacity,
        metalness: 0.28,
        roughness: 0.54,
        emissive: 0x0b2024,
        emissiveIntensity: 0.15,
        depthWrite: true,
      });
    }
    detailMaterials.set(key, material);
    return material;
  }

  function addDetailBox(group, x, z, w, d, h, color, opts = {}) {
    const base = SLAB_T + 0.06;
    const material = getDetailMaterial(color, opts.opacity ?? 1, opts.glass, opts.ghost);
    const geometry = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, base + h / 2, z);
    mesh.castShadow = !opts.ghost;
    mesh.receiveShadow = true;
    group.add(mesh);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: opts.edgeColor ?? 0x183338,
      transparent: true,
      opacity: opts.ghost ? 0.38 : 0.64,
      depthWrite: false,
    });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    edges.position.copy(mesh.position);
    group.add(edges);
    return mesh;
  }

  function buildOneFEquipment(group) {
    const raw = DETAIL_COLORS.raw;
    const weld = DETAIL_COLORS.weld;
    const cdu = DETAIL_COLORS.cdu;
    const surface = DETAIL_COLORS.surface;
    const ring = DETAIL_COLORS.ring;
    const lab = DETAIL_COLORS.lab;

    // 1F-01: west high-bay raw material storage.
    for (let i = 0; i < 4; i++) {
      addDetailBox(group, -71, -20 + i * 10, 4.2, 6.3, 3.5, raw, {
        opacity: 0.72,
        edgeColor: 0x5b6539,
      });
    }
    // 1F-02: transfer carts / pallets.
    addDetailBox(group, -52, 23.5, 3.8, 2.1, 0.85, raw, { opacity: 0.9 });
    addDetailBox(group, -55, 25.5, 2.4, 1.8, 1.0, raw, { opacity: 0.8 });

    // 1F-04/05: cutting, forming, hole-making, welding.
    addDetailBox(group, -48, 6.6, 6.2, 2.5, 2.2, weld);
    addDetailBox(group, -48, 11.0, 4.4, 2.0, 1.7, weld);
    addDetailBox(group, -48, 14.8, 4.4, 2.0, 1.7, weld);
    addDetailBox(group, -40, 7.2, 6.0, 2.0, 1.55, weld);
    addDetailBox(group, -40, 11.4, 6.0, 2.0, 1.5, weld);
    addDetailBox(group, -33, 6.7, 7.0, 2.2, 1.75, weld);
    addDetailBox(group, -33, 11.5, 4.4, 3.6, 2.2, weld);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        addDetailBox(group, -29 + col * 3.1, 14.2 + row * 2.35, 2.5, 1.8, 1.15, weld, {
          edgeColor: 0x234a51,
        });
      }
    }
    // A small line-side tool rack between cutting and assembly.
    addDetailBox(group, -23.5, 7.2, 2.2, 6.2, 1.0, raw, { opacity: 0.75 });

    // 1F-06: the drawing shows about 40+ CDU pipe assembly workstations.
    const benchGeo = new THREE.BoxGeometry(2.85, 0.9, 1.35);
    const benchMat = getDetailMaterial(cdu, 0.95);
    const benchEdgeMat = new THREE.LineBasicMaterial({
      color: 0x233c59,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const benchEdge = new THREE.EdgesGeometry(benchGeo);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 10; col++) {
        const x = -20 + col * 4.78;
        const z = 13.6 + row * 4.45;
        const bench = new THREE.Mesh(benchGeo, benchMat);
        bench.position.set(x, SLAB_T + 0.06 + 0.45, z);
        bench.castShadow = true;
        bench.receiveShadow = true;
        group.add(bench);
        const edge = new THREE.LineSegments(benchEdge, benchEdgeMat);
        edge.position.copy(bench.position);
        group.add(edge);
      }
    }
    // Two line-side material racks inside the CDU zone.
    addDetailBox(group, -22, 10.8, 2.0, 8.0, 1.15, raw, { opacity: 0.72 });
    addDetailBox(group, 24, 10.8, 2.0, 8.0, 1.15, raw, { opacity: 0.72 });

    // 1F-07: surface treatment tank line.
    for (let i = 0; i < 4; i++) {
      addDetailBox(group, 28.4 + i * 4.1, 7.4, 2.8, 2.7, 1.2, surface, {
        edgeColor: 0x694522,
      });
    }
    addDetailBox(group, 43.0, 11.2, 1.8, 2.2, 1.7, surface, { opacity: 0.85 });

    // 1F-08: secondary-loop assembly / temporary storage.
    addDetailBox(group, 28.5, 17.6, 7.3, 1.7, 1.15, ring, { opacity: 0.82 });
    addDetailBox(group, 37.0, 17.6, 6.4, 1.7, 1.15, ring, { opacity: 0.82 });
    addDetailBox(group, 31.5, 20.5, 8.4, 1.4, 0.95, ring, { opacity: 0.78 });

    // 1F-09: east pipe preassembly tables.
    addDetailBox(group, 57.5, 8.0, 12.0, 2.1, 0.95, ring, { opacity: 0.84 });
    addDetailBox(group, 57.5, 13.6, 12.0, 2.1, 0.95, ring, { opacity: 0.84 });
    addDetailBox(group, 57.5, 19.2, 12.0, 2.0, 0.95, ring, { opacity: 0.8 });
    addDetailBox(group, 72.0, 13.2, 2.2, 8.0, 1.75, raw, { opacity: 0.72 });

    // 1F-10: laboratory glass enclosure and test equipment.
    addDetailBox(group, 65.0, -25.0, 22.0, 0.16, 2.3, 0x6f9ba2, {
      glass: true, opacity: 0.2, edgeColor: 0x477377,
    });
    addDetailBox(group, 65.0, -0.9, 22.0, 0.16, 2.3, 0x6f9ba2, {
      glass: true, opacity: 0.2, edgeColor: 0x477377,
    });
    addDetailBox(group, 54.2, -13.0, 0.16, 24.2, 2.3, 0x6f9ba2, {
      glass: true, opacity: 0.2, edgeColor: 0x477377,
    });
    addDetailBox(group, 75.8, -13.0, 0.16, 24.2, 2.3, 0x6f9ba2, {
      glass: true, opacity: 0.2, edgeColor: 0x477377,
    });
    addDetailBox(group, 61.8, -20.3, 5.0, 3.4, 2.35, lab, { edgeColor: 0x594725 });
    addDetailBox(group, 69.6, -20.2, 4.0, 4.0, 0.8, lab, { edgeColor: 0x594725 });
    addDetailBox(group, 60.3, -9.5, 9.0, 2.0, 0.9, lab, { opacity: 0.82 });
    addDetailBox(group, 72.7, -10.0, 2.0, 4.0, 1.8, lab, { opacity: 0.82 });

    // 1F-12: line-side carts north of the CDU assembly area.
    addDetailBox(group, 19.0, 4.5, 3.0, 1.6, 0.9, raw, { opacity: 0.78 });
    addDetailBox(group, 22.5, 7.8, 2.4, 1.4, 1.03, raw, { opacity: 0.74 });
    addDetailBox(group, 18.5, 10.2, 2.2, 1.3, 0.8, raw, { opacity: 0.7 });

    buildOneFPlaza(group);
  }

  function buildOneFPlaza(group) {
    const zone = ONE_F_ZONES.find((item) => item.id === '1F-11');
    if (!zone) return;
    const rect = zoneRect(zone);
    const base = SLAB_T + 0.08;

    // The plaza sits in the open north court; give it a low paved podium so
    // the landscape does not float when the 1F slab becomes U-shaped.
    const podiumHeight = SLAB_T - 0.03;
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w, podiumHeight, rect.d),
      new THREE.MeshStandardMaterial({
        color: 0x33443e,
        roughness: 0.96,
        metalness: 0.02,
      })
    );
    podium.position.set(rect.cx, podiumHeight / 2, rect.cz);
    podium.receiveShadow = true;
    group.add(podium);
    const podiumEdgePoints = [
      new THREE.Vector3(rect.x1, podiumHeight + 0.01, rect.z1),
      new THREE.Vector3(rect.x2, podiumHeight + 0.01, rect.z1),
      new THREE.Vector3(rect.x2, podiumHeight + 0.01, rect.z2),
      new THREE.Vector3(rect.x1, podiumHeight + 0.01, rect.z2),
      new THREE.Vector3(rect.x1, podiumHeight + 0.01, rect.z1),
    ];
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(podiumEdgePoints),
      new THREE.LineBasicMaterial({ color: 0x6c8377, transparent: true, opacity: 0.5, depthWrite: false })
    ));

    // Paving joints / hardscape grid.
    const gridPoints = [];
    for (let x = rect.x1 + 2; x <= rect.x2 - 1; x += 8) {
      gridPoints.push(new THREE.Vector3(x, base, rect.z1 + 1), new THREE.Vector3(x, base, rect.z2 - 1));
    }
    for (let z = rect.z1 + 2; z <= rect.z2 - 1; z += 8) {
      gridPoints.push(new THREE.Vector3(rect.x1 + 1, base, z), new THREE.Vector3(rect.x2 - 1, base, z));
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPoints),
      new THREE.LineBasicMaterial({
        color: 0xb7ad98,
        transparent: true,
        opacity: 0.20,
        depthWrite: false,
      })
    );
    grid.renderOrder = 5;
    group.add(grid);

    // Central paved circle.
    const circle = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.4, 0.10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x8e9789,
        roughness: 0.92,
        metalness: 0.02,
        transparent: true,
        opacity: 0.82,
      })
    );
    circle.position.set(-4, SLAB_T + 0.13, -16);
    circle.receiveShadow = true;
    group.add(circle);
    const ringPoints = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(-4 + Math.cos(angle) * 6.4, SLAB_T + 0.20, -16 + Math.sin(angle) * 6.4));
    }
    group.add(new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({ color: 0xd0c4aa, transparent: true, opacity: 0.48, depthWrite: false })
    ));

    // Planters, trees and benches: this is a campus plaza, not a production zone.
    const planterPositions = [
      [-47, -28], [-27, -28], [-7, -28], [13, -28], [33, -28], [-47, -4],
    ];
    planterPositions.forEach(([x, z]) => {
      addDetailBox(group, x, z, 4.3, 2.8, 0.62, 0x5f7f62, {
        edgeColor: 0x344a39, opacity: 0.92,
      });
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.24, 1.25, 7),
        new THREE.MeshStandardMaterial({ color: 0x66513c, roughness: 0.95 })
      );
      trunk.position.set(x, SLAB_T + 0.8, z);
      trunk.castShadow = true;
      group.add(trunk);
      const canopy = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.3, 1),
        new THREE.MeshStandardMaterial({ color: 0x4f7652, roughness: 0.9 })
      );
      canopy.position.set(x, SLAB_T + 2.1, z);
      canopy.castShadow = true;
      group.add(canopy);
    });

    [
      [-18, -8, 4.5], [3, -8, 4.5], [-23, -22, 3.8], [15, -22, 3.8],
    ].forEach(([x, z, w]) => {
      addDetailBox(group, x, z, w, 0.8, 0.36, 0x8b7e64, { opacity: 0.85 });
    });
  }

  function addStationLine(group, x1, x2, z, count, width, depth, height, color, opts = {}) {
    const start = x1 + (x2 - x1) * 0.08;
    const end = x2 - (x2 - x1) * 0.08;
    const step = count > 1 ? (end - start) / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      addDetailBox(group, start + step * i, z, width, depth, height, color, opts);
    }
  }

  function buildTwoFStation(group, x, z, index) {
    const steel = 0x8ba6a8;
    const dark = 0x5c7480;
    const glow = 0x77c5bf;

    if (index === 0) {
      // Pump installation.
      addDetailBox(group, x, z, 3.2, 1.6, 0.30, dark, { opacity: 0.8 });
      addDetailCylinder(group, x - 0.65, z, 0.42, 0.9, steel);
      addDetailBox(group, x + 0.65, z, 1.0, 0.9, 0.8, 0x708b91, { opacity: 0.9 });
    } else if (index === 1) {
      // Plate heat exchanger stack.
      for (let j = 0; j < 7; j++) {
        addDetailBox(group, x - 0.9 + j * 0.20, z, 0.10, 1.15, 0.9, steel, { opacity: 0.94 });
      }
      addDetailBox(group, x - 0.2, z, 1.8, 1.5, 0.16, dark, { opacity: 0.9 });
    } else if (index === 2 || index === 3) {
      // Primary / secondary side installation: a small manifold frame.
      addDetailBox(group, x, z, 2.7, 1.35, 0.35, dark, { opacity: 0.78 });
      addDetailBox(group, x, z - 0.38, 2.2, 0.12, 0.12, glow, { opacity: 0.95 });
      addDetailBox(group, x, z + 0.38, 2.2, 0.12, 0.12, glow, { opacity: 0.95 });
      addDetailBox(group, x, z, 0.35, 0.95, 1.1, 0x6f9298, { opacity: 0.8 });
    } else if (index === 4) {
      // Water tank installation.
      addDetailBox(group, x, z, 3.1, 1.5, 0.30, dark, { opacity: 0.8 });
      addDetailCylinder(group, x, z, 0.78, 1.55, 0x7e9b9b);
      addDetailBox(group, x + 0.95, z, 0.8, 0.8, 0.55, steel, { opacity: 0.8 });
    } else if (index === 5) {
      // Sensor installation.
      addDetailBox(group, x, z, 2.6, 1.25, 0.28, dark, { opacity: 0.8 });
      [-0.65, 0, 0.65].forEach((dx) => {
        addDetailCylinder(group, x + dx, z, 0.10, 0.62, glow);
        addDetailBox(group, x + dx, z, 0.22, 0.22, 0.10, 0x50666a, { opacity: 0.9 });
      });
      addDetailBox(group, x + 0.85, z, 0.42, 0.55, 0.35, 0x68888b, { opacity: 0.9 });
    } else if (index === 6) {
      // Pressure hold / leak-check station.
      addDetailBox(group, x, z, 2.5, 1.6, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x, z, 1.35, 1.05, 1.15, 0x6b878b, { opacity: 0.92 });
      addDetailBox(group, x + 0.9, z, 0.55, 0.75, 0.65, 0x899f9d, { opacity: 0.9 });
      addDetailCylinder(group, x - 0.75, z, 0.22, 0.85, glow);
    } else if (index === 7) {
      // Safety / hipot test station.
      addDetailBox(group, x, z, 2.5, 1.55, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x, z, 1.3, 0.9, 0.65, 0x6d888d, { opacity: 0.9 });
      addDetailBox(group, x - 0.4, z, 0.12, 0.7, 1.6, steel, { opacity: 0.9 });
      addDetailBox(group, x + 0.4, z, 0.12, 0.7, 1.6, steel, { opacity: 0.9 });
      addDetailBox(group, x, z, 1.0, 0.7, 0.16, 0x4b6269, { opacity: 0.9 });
    } else if (index === 8) {
      // Helium leak test chamber.
      addDetailBox(group, x, z, 2.7, 1.6, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x - 0.3, z, 1.5, 1.15, 1.1, 0x5d7880, { opacity: 0.95 });
      addDetailBox(group, x + 0.9, z, 0.16, 0.16, 1.2, glow, { opacity: 0.95 });
      addDetailBox(group, x + 0.65, z - 0.5, 0.8, 0.65, 0.4, 0x7d9796, { opacity: 0.9 });
    } else if (index === 9) {
      // Electrical cabinet installation.
      addDetailBox(group, x, z, 2.6, 1.55, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x, z, 1.15, 0.9, 1.75, 0x667f86, { opacity: 0.96 });
      addDetailBox(group, x - 0.8, z, 0.45, 0.7, 0.9, 0x526d75, { opacity: 0.9 });
      addDetailBox(group, x, z, 0.7, 0.06, 0.07, 0x9eb4ad, { opacity: 0.9 });
    } else if (index === 10) {
      // Secondary wiring / harness.
      addDetailBox(group, x, z, 2.7, 1.55, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x, z, 1.55, 0.9, 0.72, 0x738b8d, { opacity: 0.9 });
      addDetailCylinder(group, x - 0.7, z, 0.24, 0.28, 0xb48d63);
      addDetailCylinder(group, x + 0.7, z, 0.24, 0.28, 0x6f99a0);
    } else {
      // Dot / traceability marking.
      addDetailBox(group, x, z, 2.5, 1.55, 0.30, dark, { opacity: 0.8 });
      addDetailBox(group, x - 0.6, z, 0.12, 0.8, 1.45, steel, { opacity: 0.9 });
      addDetailBox(group, x + 0.6, z, 0.12, 0.8, 1.45, steel, { opacity: 0.9 });
      addDetailBox(group, x, z, 1.35, 0.7, 0.14, 0x526c72, { opacity: 0.9 });
      addDetailCylinder(group, x, z, 0.16, 0.28, glow);
    }
  }

  function addDashedRect(group, x1, z1, x2, z2, color = 0xd0b36f, opacity = 0.72) {
    const points = [
      new THREE.Vector3(x1, SLAB_T + 0.075, z1),
      new THREE.Vector3(x2, SLAB_T + 0.075, z1),
      new THREE.Vector3(x2, SLAB_T + 0.075, z2),
      new THREE.Vector3(x1, SLAB_T + 0.075, z2),
      new THREE.Vector3(x1, SLAB_T + 0.075, z1),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color, dashSize: 2.0, gapSize: 1.25, transparent: true, opacity, depthWrite: false,
      })
    );
    line.computeLineDistances();
    group.add(line);
    return line;
  }

  function buildTwoFEquipment(group) {
    const z = Object.fromEntries(TWO_F_ZONES.map((zone) => [zone.id, zoneRect(zone)]));
    const storeColor = DETAIL_COLORS.storage;
    const packColor = DETAIL_COLORS.pack;
    const preColor = DETAIL_COLORS.preassembly;

    // 2F-04: CDU automated assembly line, 12 named stations.
    const line = z['2F-04'];
    const lineZ = line.cz;
    addDetailBox(group, line.cx, lineZ, line.w - 4.2, 2.7, 0.34, 0x3e7a85, { opacity: 0.58 });
    addDetailBox(group, line.cx, lineZ - 1.5, line.w - 4.2, 0.12, 0.12, 0x6b9ca1, { opacity: 0.7 });
    const stationNames = [
      '水泵安装', '板换安装', '一次侧安装', '二次侧安装',
      '水箱系统安装', '传感器安装', '保压', '安规测试',
      '氦质谱检漏', '电气安装', '二次接线', '打点/追溯',
    ];
    const start = line.x1 + 4.4;
    const end = line.x2 - 4.4;
    const step = (end - start) / (stationNames.length - 1);
    stationNames.forEach((name, i) => {
      const x = start + step * i;
      addDetailBox(group, x, lineZ, 4.25, 2.45, 0.16, 0x2c5c66, { opacity: 0.9 });
      buildTwoFStation(group, x, lineZ, i);
      addPickProxy(group, x, lineZ, 4.5, 2.7, 2.0, {
        zone: '2F-04', groupName: 'CDU总装自动化线',
        name: `${String(i + 1).padStart(2, '0')}  ${name}`,
        sub: '12工位倍速链 · 2F-04 · 设备体块示意', color: '#6fc7c1',
      });
    });
    // End-of-line transfer/index.
    addDetailBox(group, line.x2 - 2.6, lineZ, 2.2, 2.2, 1.35, 0x6fadb2, { opacity: 0.9 });

    // 2F-07/08: five preassembly lines in each room.
    const preTypes = [
      { name: '水箱系统预装', kind: 'tank', color: 0x5f9ca6 },
      { name: '保温包覆', kind: 'insulation', color: 0x6f9a7a },
      { name: '一次侧预装', kind: 'primary', color: 0x668fae },
      { name: '二次侧预装', kind: 'secondary', color: 0x7b89ad },
      { name: '标签制作', kind: 'label', color: 0xa38c61 },
    ];
    [
      ['2F-07', '北'],
      ['2F-08', '南'],
    ].forEach(([zoneId, side]) => {
      const room = z[zoneId];
      const x1 = room.x1 + 2;
      const x2 = room.x2 - 2;
      preTypes.forEach((type, i) => {
        const zLine = room.z1 + 1.9 + i * 2.35;
        addDetailBox(group, (x1 + x2) / 2, zLine, x2 - x1, 1.45, 0.30, preColor, { opacity: 0.54 });
        // Head unit at the downstream end.
        const hx = x2 - 3.0;
        if (type.kind === 'tank') {
          addDetailCylinder(group, hx, zLine, 0.62, 1.15, type.color);
        } else if (type.kind === 'insulation') {
          addDetailBox(group, hx, zLine, 1.9, 1.25, 1.15, type.color, { opacity: 0.9 });
          addDetailBox(group, hx, zLine - 0.72, 1.5, 0.18, 0.18, 0x8cae91, { opacity: 0.8 });
        } else if (type.kind === 'primary' || type.kind === 'secondary') {
          addDetailBox(group, hx, zLine, 1.8, 1.2, 0.85, type.color, { opacity: 0.9 });
          addDetailBox(group, hx, zLine - 0.38, 1.4, 0.11, 0.11, 0xa8c0bd, { opacity: 0.9 });
          addDetailBox(group, hx, zLine + 0.38, 1.4, 0.11, 0.11, 0xa8c0bd, { opacity: 0.9 });
        } else {
          addDetailBox(group, hx, zLine, 1.3, 0.9, 0.8, type.color, { opacity: 0.9 });
          addDetailBox(group, hx + 0.9, zLine, 0.55, 0.6, 0.25, 0xa8a28e, { opacity: 0.9 });
        }
        addDetailBox(group, x1 + 2.2, zLine, 2.3, 1.1, 0.60, 0x708b8d, { opacity: 0.8 });
        addPickProxy(group, (x1 + x2) / 2, zLine, x2 - x1, 2.0, 1.9, {
          zone: zoneId, groupName: `产品预装（${side}）`,
          name: type.name, sub: '5类×2线 · 预装设备体块示意', color: '#5fb7b0',
        });
      });
    });

    // 2F-01: two packaging lines (wrapping + wooden crate), west wing.
    [-24, -12].forEach((packZ, i) => {
      addDetailBox(group, -64, packZ, 14.0, 2.3, 0.38, packColor, { opacity: 0.60 });
      addDetailCylinder(group, -58.5, packZ, 0.92, 1.35, 0x6e9a7d);
      addDetailBox(group, -70.5, packZ, 3.2, 2.1, 1.45, 0x9d7f58, { opacity: 0.9 });
      addDetailBox(group, -66.5, packZ, 1.5, 1.55, 0.75, 0x7e9c82, { opacity: 0.9 });
      addDetailBox(group, -74.5, packZ, 2.6, 1.8, 0.25, 0x5a6f62, { opacity: 0.9 });
      addPickProxy(group, -64, packZ, 15.2, 2.8, 2.1, {
        zone: '2F-01', groupName: `包装线 ${i + 1}`,
        name: '自动缠绕 + 木箱 + 码垛',
        sub: '2条包装线 · 2F-01 · 设备体块示意', color: '#78b596',
      });
    });
    for (let i = 0; i < 4; i++) {
      addDetailBox(group, -70 + i * 4.2, -30.2, 2.3, 1.4, 0.65, packColor, { opacity: 0.65 });
    }

    // 2F-02/03: finished storage and shipping.
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -75, 2 + i * 6.0, 4.0, 1.8, 2.25, storeColor, { opacity: 0.62 });
    }
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -70 + i * 5.5, 25, 4.2, 2.2, 1.1, DETAIL_COLORS.shipping, { opacity: 0.7 });
    }

    // 2F-05: one lower-half reserve zone containing the big/small CDU line frames.
    const reserve = z['2F-05'];
    const split = reserve.x1 + reserve.w * 0.55;
    addDashedRect(group, reserve.x1 + 1.2, reserve.z1 + 1.2, split - 0.8, reserve.z2 - 1.2);
    addDashedRect(group, split + 0.8, reserve.z1 + 1.2, reserve.x2 - 1.2, reserve.z2 - 1.2);

    // 2F-09 semi-finished turnover racks on the east spine.
    for (let i = 0; i < 4; i++) {
      addDetailBox(group, 69, -24 + i * 10, 5.2, 1.9, 2.4, storeColor, { opacity: 0.64 });
    }

    // 2F-10 office / meeting / rest zone.
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        addDetailBox(group, -19 + col * 7.0, -6.5 + row * 4.0, 3.0, 1.2, 0.72, DETAIL_COLORS.office, { opacity: 0.8 });
      }
    }
    addDetailBox(group, 14, -4, 5.2, 2.2, 0.75, DETAIL_COLORS.office, { opacity: 0.76 });

    // 2F-05 remains the lower-half reserve; its two dashed sub-frames are
    // the big/small CDU line positions.
  }

  function addDetailCylinder(group, x, z, radius, height, color, opts = {}) {
    const base = SLAB_T + 0.06 + (opts.baseLift || 0);
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: opts.opacity ?? 0.9,
      emissive: 0x0b2024,
      emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, base + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function addPickProxy(group, x, z, w, d, h, info) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, SLAB_T + 0.06 + h / 2, z);
    mesh.userData.equipment = info;
    group.add(mesh);
    twoFPickables.push(mesh);
    return mesh;
  }

  function buildThreeFEquipment(group) {
    const z = Object.fromEntries(THREE_F_ZONES.map((zone) => [zone.id, zoneRect(zone)]));
    const elec = DETAIL_COLORS.elec;
    const rack = DETAIL_COLORS.line;
    const store = DETAIL_COLORS.warehouse;
    const clean = DETAIL_COLORS.clean;
    const assembly = DETAIL_COLORS.assembly;

    // 3F-01: four long electrical assembly/test benches.
    for (let i = 0; i < 4; i++) {
      addDetailBox(group, -65, -27 + i * 8.5, 18, 2.0, 0.95, elec, { opacity: 0.82 });
    }
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -76, -14 + i * 11, 2.0, 2.0, 1.5, elec, { opacity: 0.72 });
    }

    // 3F-02 prototype bench.
    addDetailBox(group, -65, 6.0, 16, 2.1, 0.9, DETAIL_COLORS.trial, { opacity: 0.8 });

    // 3F-03/04: two rack CDU assembly/test lines.
    for (let row = 0; row < 2; row++) {
      const zLine = 12.5 + row * 5.2;
      addDetailBox(group, -65, zLine, 20, 1.8, 0.55, 0x3e7a85, { opacity: 0.45 });
      addStationLine(group, -75, -55, zLine, 5, 2.6, 1.6, 1.45, rack);
    }
    // Low finished-goods racks in the western end.
    addDetailBox(group, -61, 27, 10, 2.0, 2.2, store, { opacity: 0.64 });

    // 3F-06/07 west unpacking and sorting.
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -48, 1 + i * 8, 5.0, 2.0, 0.85, DETAIL_COLORS.logistics, { opacity: 0.78 });
    }

    // 3F-08/09 central warehouse spine.
    for (let row = 0; row < 3; row++) {
      addDetailBox(group, -8, 6 + row * 8.5, 46, 1.8, 2.5, store, {
        opacity: 0.58, edgeColor: 0x4c583e,
      });
    }
    for (let row = 0; row < 2; row++) {
      addDetailBox(group, 43, 8 + row * 11, 27, 1.8, 2.3, store, {
        opacity: 0.56, edgeColor: 0x4c583e,
      });
    }

    // 3F-10: MF cleanroom envelope + clean assembly/test equipment.
    const cleanRoom = z['3F-10'];
    const wallColor = 0x6f9ba2;
    addDetailBox(group, cleanRoom.cx, cleanRoom.z1 + 0.2, cleanRoom.w, 0.16, 2.4, wallColor, {
      glass: true, opacity: 0.2, edgeColor: 0x3e676b,
    });
    addDetailBox(group, cleanRoom.cx, cleanRoom.z2 - 0.2, cleanRoom.w, 0.16, 2.4, wallColor, {
      glass: true, opacity: 0.2, edgeColor: 0x3e676b,
    });
    addDetailBox(group, cleanRoom.x1 + 0.2, cleanRoom.cz, 0.16, cleanRoom.d, 2.4, wallColor, {
      glass: true, opacity: 0.2, edgeColor: 0x3e676b,
    });
    addDetailBox(group, cleanRoom.x2 - 0.2, cleanRoom.cz, 0.16, cleanRoom.d, 2.4, wallColor, {
      glass: true, opacity: 0.2, edgeColor: 0x3e676b,
    });
    addDetailBox(group, 63, -20, 11, 2.2, 0.9, clean, { opacity: 0.8 });
    addDetailBox(group, 63, -10, 11, 2.2, 0.9, clean, { opacity: 0.8 });
    addDetailBox(group, 71, -27, 5, 3.0, 1.8, clean, { opacity: 0.8 });

    // 3F-11 MF assembly benches.
    for (let i = 0; i < 2; i++) {
      addDetailBox(group, 61, -2 + i * 4.0, 10, 2.0, 0.9, assembly, { opacity: 0.82 });
    }
    addDetailBox(group, 63, 1, 4.0, 3.0, 1.6, assembly, { opacity: 0.75 });

    // East buffers and finished-goods racks.
    for (let i = 0; i < 2; i++) {
      addDetailBox(group, 70, -21 + i * 8, 4.5, 1.8, 2.0, store, { opacity: 0.6 });
    }
    for (let i = 0; i < 2; i++) {
      addDetailBox(group, 65, 12 + i * 7, 8.0, 1.8, 1.8, store, { opacity: 0.58 });
    }
    addDetailBox(group, 68, 28, 8.0, 2.0, 2.2, store, { opacity: 0.62 });
  }

  function buildFourFEquipment(group) {
    const z = Object.fromEntries(FOUR_F_ZONES.map((zone) => [zone.id, zoneRect(zone)]));
    const lab = DETAIL_COLORS.lab;
    const trial = DETAIL_COLORS.trial;
    const office = DETAIL_COLORS.office;
    const storage = DETAIL_COLORS.storage;

    // 4F-01 / 4F-04: laboratory benches and environmental/test equipment.
    addDetailBox(group, -66, -22, 14, 2.0, 0.9, lab, { opacity: 0.82 });
    addDetailBox(group, -66, -14, 14, 2.0, 0.9, lab, { opacity: 0.82 });
    addDetailBox(group, -54, -27, 4.2, 3.0, 2.2, lab, { edgeColor: 0x594725 });
    addDetailBox(group, -40, -3, 3.4, 3.4, 0.75, lab, { edgeColor: 0x594725 });

    addDetailBox(group, -34, 2, 14, 2.0, 0.9, lab, { opacity: 0.82 });
    addDetailBox(group, -34, 10, 14, 2.0, 0.9, lab, { opacity: 0.82 });
    addDetailBox(group, -34, 20, 12, 2.2, 1.0, lab, { opacity: 0.8 });
    addDetailBox(group, -23, 25, 5.0, 3.0, 1.9, lab, { opacity: 0.82 });

    // 4F-02 trial workshop.
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -66, -2 + i * 7, 15, 2.2, 0.9, trial, { opacity: 0.82 });
    }
    addDetailBox(group, -56, 16, 3.0, 6.0, 1.8, trial, { opacity: 0.74 });

    // 4F-03 temporary finished storage.
    addDetailBox(group, -60, 25, 9, 1.8, 2.0, storage, { opacity: 0.6 });

    // 4F-05 showroom: display platform, plinths, video wall.
    addDetailBox(group, -5, 5, 17, 8.5, 0.35, DETAIL_COLORS.showroom, { opacity: 0.36 });
    addDetailBox(group, -5, -2.0, 14, 0.2, 2.0, 0x587a83, { opacity: 0.65 });
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, -10 + i * 5, 5, 2.5, 2.5, 0.85, DETAIL_COLORS.showroom, { opacity: 0.8 });
    }

    // 4F-06 showroom meeting room.
    addDetailBox(group, -5, 23, 8.0, 3.0, 0.78, DETAIL_COLORS.meeting, { opacity: 0.8 });
    for (let i = 0; i < 6; i++) {
      addDetailBox(group, -9 + i * 1.7, 20.6, 0.55, 0.55, 0.8, DETAIL_COLORS.meeting, { opacity: 0.7 });
      addDetailBox(group, -9 + i * 1.7, 25.4, 0.55, 0.55, 0.8, DETAIL_COLORS.meeting, { opacity: 0.7 });
    }

    // 4F-07 office clusters.
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        addDetailBox(group, 24 + col * 7.5, -7 + row * 6.5, 3.2, 1.3, 0.72, office, { opacity: 0.75 });
      }
    }
    addDetailBox(group, 33, 12, 8, 2.4, 0.78, office, { opacity: 0.7 });

    // 4F-08 auditorium: stage and seating rows.
    addDetailBox(group, 68, -27, 14, 4.0, 0.6, DETAIL_COLORS.auditorium, { opacity: 0.5 });
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 7; col++) {
        addDetailBox(group, 60 + col * 2.2, -19 + row * 2.0, 0.7, 0.6, 0.7, DETAIL_COLORS.auditorium, { opacity: 0.66 });
      }
    }

    // 4F-09 hands-on training.
    for (let i = 0; i < 3; i++) {
      addDetailBox(group, 66, -2 + i * 5, 9, 2.0, 0.9, DETAIL_COLORS.training, { opacity: 0.8 });
    }
    addDetailBox(group, 73, 2, 2.2, 4.5, 1.6, DETAIL_COLORS.training, { opacity: 0.7 });

    // 4F-10 training centre classroom.
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        addDetailBox(group, 60 + col * 5.5, 18 + row * 4.2, 3.8, 1.3, 0.75, DETAIL_COLORS.training, { opacity: 0.7 });
      }
    }
  }

  function buildFloorStubs(floor) {
    const group = new THREE.Group();
    const points = floor.columnPoints || [];
    if (!points.length) return group;

    const geometry = new THREE.BoxGeometry(0.52, 0.95, 0.52);
    geometry.translate(0, 0.475, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xaec2c0,
      metalness: 0.4,
      roughness: 0.45,
      transparent: true,
      opacity: 0.86,
    });
    const stubs = new THREE.InstancedMesh(geometry, material, points.length);
    stubs.castShadow = true;
    stubs.receiveShadow = true;
    stubs.frustumCulled = false;
    const dummy = new THREE.Object3D();
    points.forEach(([x, z], i) => {
      dummy.position.set(x, SLAB_T + 0.06, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      stubs.setMatrixAt(i, dummy.matrix);
    });
    stubs.instanceMatrix.needsUpdate = true;
    group.add(stubs);
    return group;
  }

  function zoneTagAnchor(zone) {
    if (zone.labelAt) return zone.labelAt;
    const rect = zoneRect(zone);
    return [rect.cx, rect.cz];
  }

  function buildZoneTags(floorIndex, zones) {
    const host = $('#zoneTags');
    if (!host) return;
    const tags = [];
    zones.filter((zone) => zone.label).forEach((zone) => {
      const el = document.createElement('div');
      el.className = 'zone-tag';
      el.style.setProperty('--zone-color', `#${new THREE.Color(DETAIL_COLORS[zone.kind] || 0x899a9d).getHexString()}`);
      el.innerHTML = `<span class="zone-id">${zone.id}</span><span class="zone-name">${zone.label}</span>`;
      host.appendChild(el);
      tags.push({ zone, el });
    });
    zoneTagSets.set(floorIndex, tags);
  }

  function hideAllZoneTags() {
    zoneTagSets.forEach((tags) => tags.forEach(({ el }) => el.classList.remove('visible')));
  }

  function updateZoneTags() {
    const visible = state.mode === 'detail' && state.layers.labels;
    if (!visible) {
      hideAllZoneTags();
      return;
    }
    const floorIndex = state.detailFloor;
    const tags = zoneTagSets.get(floorIndex) || [];
    const floorGroup = FLOOR_DEFS[floorIndex].group;
    const vector = new THREE.Vector3();

    zoneTagSets.forEach((set, index) => {
      if (index !== floorIndex) set.forEach(({ el }) => el.classList.remove('visible'));
    });

    tags.forEach(({ zone, el }) => {
      const anchor = zoneTagAnchor(zone);
      vector.set(anchor[0], SLAB_T + 3.9, anchor[1]);
      if (floorGroup) floorGroup.localToWorld(vector);
      vector.project(camera);
      if (vector.z < -1 || vector.z > 1) {
        el.classList.remove('visible');
        return;
      }
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
      el.classList.add('visible');
    });
  }

  function buildDetailLayer(floor, zones, equipmentBuilder) {
    const root = new THREE.Group();
    root.visible = false;
    floor.group.add(root);

    const zoneGroup = new THREE.Group();
    const equipmentGroup = new THREE.Group();
    const labelGroup = new THREE.Group();
    const stubsGroup = buildFloorStubs(floor);
    root.add(zoneGroup, labelGroup, stubsGroup, equipmentGroup);

    zones.forEach((zone) => addZonePatch(zone, zoneGroup, labelGroup));
    equipmentBuilder(equipmentGroup);
    buildZoneTags(floor.index, zones);

    const layer = { root, zoneGroup, equipmentGroup, labelGroup, stubs: stubsGroup, zones };
    detailLayers[floor.index] = layer;
    return layer;
  }

  function buildFloor(floor) {
    const group = new THREE.Group();
    group.position.y = floor.level;
    floor.group = group;

    const sub = {
      slabs: new THREE.Group(),
      columns: new THREE.Group(),
      beams: new THREE.Group(),
      cores: new THREE.Group(),
      labels: new THREE.Group(),
      roof: new THREE.Group(),
    };
    Object.values(sub).forEach((g) => group.add(g));
    floor.sub = sub;

    buildSlab(floor, sub.slabs);
    buildEdgeBeams(floor, sub.beams);
    buildColumns(floor, sub.columns);
    buildCores(floor, sub.cores);

    if (floor.index === 3) buildRoof(floor, sub.roof);

    const label = makeFloorLabel(floor);
    sub.labels.add(label);
    const labelMat = label.material;
    registerFade(floor, labelMat, 1, true);
    floor.label = label;

    const leaderMat = new THREE.LineBasicMaterial({
      color: floor.color,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    registerFade(floor, leaderMat, 0.44, true);
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-82.4, SLAB_T + 0.2, 0),
        new THREE.Vector3(-97.2, 2.2, 0),
      ]),
      leaderMat
    );
    sub.labels.add(leader);

    floor.fade = 1;
    floor.fadeTarget = 1;

    return group;
  }

  function buildBuilding(root) {
    const building = new THREE.Group();
    root.add(building);

    FLOOR_DEFS.forEach((floor) => {
      const group = buildFloor(floor);
      group.position.y = floor.level;
      building.add(group);
      floorGroups.push(group);
    });

    const detailPrograms = [
      [ONE_F_ZONES, buildOneFEquipment],
      [TWO_F_ZONES, buildTwoFEquipment],
      [THREE_F_ZONES, buildThreeFEquipment],
      [FOUR_F_ZONES, buildFourFEquipment],
    ];
    FLOOR_DEFS.forEach((floor, index) => {
      const [zones, builder] = detailPrograms[index];
      buildDetailLayer(floor, zones, builder);
    });

    return building;
  }

  function makeCameraAndControls() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 1500);
    camera.position.set(-168, 110, 186);
    camera.lookAt(8, 14, 0);

    controls = new OrbitControls(camera, canvas);
    controls.target.set(8, 14, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 85;
    controls.maxDistance = 520;
    controls.minPolarAngle = 0.06;
    controls.maxPolarAngle = Math.PI * 0.492;
    controls.autoRotate = state.autoRotate;
    controls.autoRotateSpeed = 0.36;
    controls.update();
  }

  function init() {
    if (!window.THREE) throw new Error('Three.js 未加载。请检查 vendor/three.global.js。');
    if (!window.OrbitControls) throw new Error('OrbitControls 未加载。请检查 vendor/orbit-controls.global.js。');

    clock = new THREE.Clock();
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);
    buildSite(root);
    buildBuilding(root);

    // Lighting: cool ambient with a warm, low sun and a cyan rim.
    const hemi = new THREE.HemisphereLight(0xb9eee8, 0x061015, 1.05);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xf0fff8, 2.15);
    sun.position.set(-94, 150, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -165;
    sun.shadow.camera.right = 165;
    sun.shadow.camera.top = 165;
    sun.shadow.camera.bottom = -165;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 430;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    scene.add(sun.target);
    sun.target.position.set(0, 8, 0);

    const rim = new THREE.DirectionalLight(0x54b5c5, 0.55);
    rim.position.set(130, 55, -120);
    scene.add(rim);

    const warm = new THREE.PointLight(0xf0b765, 42, 210, 2);
    warm.position.set(115, 38, 65);
    scene.add(warm);

    const fill = new THREE.PointLight(0x66ded1, 24, 240, 2);
    fill.position.set(-30, 28, -60);
    scene.add(fill);

    makeCameraAndControls();
    setupUI();
    setupPointer();
    setupResize();
    bindKeys();

    // Capture mode gives the static review image a deterministic frame.
    const captureParams = new URLSearchParams(window.location.search);
    const capture = captureParams.has('capture');
    if (capture || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      state.autoRotate = false;
      const rotateInput = $('[data-layer="rotate"]');
      if (rotateInput) rotateInput.checked = false;
      controls.autoRotate = false;
    }

    // Start with a controlled reveal of the exploded frame.
    explosion = 0.0;
    explosionTarget = 1.0;

    if (capture) {
      if (boot) boot.style.display = 'none';
      if (captureParams.get('explode') === '0') {
        state.exploded = false;
        explosion = 0;
        explosionTarget = 0;
        syncExplodeUI();
      }
      const captureFloor = clamp(Math.trunc(Number(captureParams.get('floor') || 0)), 0, 3);
      if (captureParams.get('mode') === 'frame') {
        activateFrame(true);
      } else {
        activateDetail(Number.isFinite(captureFloor) ? captureFloor : 0, true);
      }
      goView(captureParams.get('view') || 'iso', true);
      updateExplosion(0, true);
    } else {
      activateDetail(0, true);
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (boot) boot.classList.add('done');
      }, 420);
    });

    animate();
  }

  function setupResize() {
    window.addEventListener('resize', () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    });
  }

  function setupPointer() {
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      downPoint = { x: event.clientX, y: event.clientY };
      downTime = performance.now();
    });

    canvas.addEventListener('pointerup', (event) => {
      if (!downPoint) return;
      const dx = event.clientX - downPoint.x;
      const dy = event.clientY - downPoint.y;
      const distance = Math.hypot(dx, dy);
      const elapsed = performance.now() - downTime;
      downPoint = null;
      if (distance > 6 || elapsed > 900) return;
      const hit = pickFloor(event.clientX, event.clientY);
      if (hit === null) return;
      if (state.mode === 'detail') return;
      activateDetail(hit);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (event.buttons) {
        hideEquipmentTip();
        return;
      }
      if (state.mode === 'detail' && state.detailFloor === 1) {
        const equipment = pickTwoFEquipment(event.clientX, event.clientY);
        if (equipment) {
          showEquipmentTip(equipment, event.clientX, event.clientY);
          canvas.style.cursor = 'help';
          return;
        }
      }
      hideEquipmentTip();
      const hit = pickFloor(event.clientX, event.clientY);
      canvas.style.cursor = hit !== null ? 'pointer' : 'grab';
    });

    canvas.addEventListener('pointerleave', () => {
      hideEquipmentTip();
      canvas.style.cursor = 'grab';
    });
  }

  function setupUI() {
    $$('.floor-row').forEach((button) => {
      button.addEventListener('click', () => {
        const raw = button.dataset.floor;
        if (raw === 'all') {
          activateFrame();
          return;
        }
        const index = Number(raw);
        if (Number.isInteger(index) && index >= 0 && index <= 3) activateDetail(index);
      });
    });

    $$('.mode-tab').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.mode === 'detail') activateDetail(state.detailFloor);
        else activateFrame();
      });
    });

    $$('[data-layer]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.layer;
        if (key === 'rotate') {
          state.autoRotate = input.checked;
          if (controls) controls.autoRotate = state.autoRotate && !cameraAnim;
          return;
        }
        state.layers[key] = input.checked;
        applyLayers();
      });
    });

    $$('[data-view]').forEach((button) => {
      button.addEventListener('click', () => goView(button.dataset.view));
    });

    const explodeBtn = $('#explodeBtn');
    if (explodeBtn) {
      explodeBtn.addEventListener('click', () => {
        state.exploded = !state.exploded;
        explosionTarget = state.exploded ? 1 : 0;
        syncExplodeUI();
      });
    }

    const dockExplode = $('#dockExplode');
    if (dockExplode) {
      dockExplode.addEventListener('click', () => {
        state.exploded = !state.exploded;
        explosionTarget = state.exploded ? 1 : 0;
        syncExplodeUI();
      });
    }

    const wireBtn = $('#wireBtn');
    if (wireBtn) {
      wireBtn.addEventListener('click', () => {
        state.wire = !state.wire;
        wireBtn.classList.toggle('active', state.wire);
        wireBtn.setAttribute('aria-pressed', String(state.wire));
        applyWireMode();
      });
    }

    const resetBtn = $('#resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetScene);

    const dockReset = $('#dockReset');
    if (dockReset) dockReset.addEventListener('click', resetScene);

    syncExplodeUI();
    applyLayers();
  }

  function syncExplodeUI() {
    const disabled = state.mode === 'detail';
    const explodeBtn = $('#explodeBtn');
    if (explodeBtn) {
      explodeBtn.disabled = disabled;
      explodeBtn.classList.toggle('active', state.exploded && !disabled);
      explodeBtn.setAttribute('aria-pressed', String(state.exploded && !disabled));
    }
    const dockExplode = $('#dockExplode');
    if (dockExplode) {
      dockExplode.disabled = disabled;
      dockExplode.classList.toggle('active', state.exploded && !disabled);
    }
  }

  function applyLayers() {
    const isDetail = state.mode === 'detail';
    const structuralLabels = state.layers.labels && !isDetail;
    floorGroups.forEach((group, i) => {
      const floor = FLOOR_DEFS[i];
      if (!floor.sub) return;
      floor.sub.slabs.visible = state.layers.slabs;
      // In a floor-detail view, tall columns are replaced by short stubs so
      // they do not obscure the equipment/zones.
      floor.sub.columns.visible = state.layers.columns && !isDetail;
      floor.sub.beams.visible = state.layers.beams;
      floor.sub.cores.visible = state.layers.cores;
      floor.sub.labels.visible = structuralLabels;
      if (floor.sub.roof) floor.sub.roof.visible = state.layers.beams && !isDetail;
    });
    detailLayers.forEach((layer, i) => {
      if (!layer) return;
      layer.root.visible = isDetail && i === state.detailFloor;
      layer.stubs.visible = isDetail && i === state.detailFloor && state.layers.columns;
    });
  }

  function syncFloorButtons() {
    const selected = state.selected;
    $$('.floor-row').forEach((button) => {
      const raw = button.dataset.floor;
      const active = raw === 'all' ? selected === null : Number(raw) === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyModeChrome(mode, detailIndex = state.detailFloor) {
    const isDetail = mode === 'detail';
    const meta = DETAIL_META[detailIndex] || DETAIL_META[0];
    const title = $('#pageTitle');
    const subtitle = $('#pageSubtitle');
    const eyebrow = $('#eyebrowLabel');

    if (isDetail) {
      if (title) title.textContent = meta.title;
      if (subtitle) subtitle.textContent = `${meta.subtitle} · ${meta.id}`;
      if (eyebrow) eyebrow.textContent = `PLANT 01 / ${meta.id} ${meta.modeLabel === '功能布局' ? 'FUNCTION LAYOUT' : 'PROCESS LAYOUT'}`;
      document.title = `1号厂房 / ${meta.title} / Floor Detail`;
    } else {
      if (title) title.textContent = FRAME_COPY.title;
      if (subtitle) subtitle.textContent = FRAME_COPY.subtitle;
      if (eyebrow) eyebrow.textContent = FRAME_COPY.eyebrow;
      document.title = FRAME_COPY.documentTitle;
    }

    const detailTabLabel = $('#detailTabLabel');
    if (detailTabLabel) detailTabLabel.textContent = `${meta.id} ${meta.modeLabel}`;
    const sourceText = $('#sourceText');
    if (sourceText) {
      sourceText.innerHTML = isDetail
        ? meta.chip
        : '<b>4F / 分区纳入</b> · 设备体块深化';
    }

    const headMeta = $('#headMeta');
    if (headMeta) {
      headMeta.innerHTML = isDetail
        ? `<span><b>${meta.rows}</b> 条清单</span><span><b>${meta.zones}</b> 个图纸分区</span><span><b>0${detailIndex + 1}</b> 层深化</span><span class="meta-muted">设备体块示意</span>`
        : '<span><b>04</b> 层</span><span><b>04</b> 个平面</span><span><b>01</b> 套结构示意</span><span class="meta-muted">尺度未标定</span>';
    }

    document.body.classList.toggle('mode-detail', isDetail);
    $$('.mode-tab').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });

    const infoGeneral = $('#infoGeneral');
    if (infoGeneral) infoGeneral.hidden = isDetail;
    const infoOneF = $('#infoOneF');
    if (infoOneF) infoOneF.hidden = true;

    const footerMode = $('#footerMode');
    const footerCenter = $('#footerCenter');
    if (footerMode) footerMode.textContent = isDetail ? `1号厂房 / ${meta.id} ${meta.modeLabel}` : '1号厂房 / 4F–1F';
    if (footerCenter) {
      footerCenter.textContent = isDetail
        ? 'PROCESS LAYOUT · SCHEMATIC · NOT FOR CONSTRUCTION'
        : 'STRUCTURAL MASSING · NOT FOR CONSTRUCTION';
    }

    const noteMark = $('#panelNoteMark');
    const noteText = $('#panelNoteText');
    if (noteMark && noteText) {
      noteMark.textContent = isDetail ? 'i' : '!';
      noteText.innerHTML = isDetail
        ? meta.note
        : '<b>四层统一结构。</b> 主楼 15×4、两翼各 3×8、北侧 1×7 凸出；2F-10 办公会议已移入凸出区，2F-04/05 分占主楼上下半区。';
    }
  }

  function activateDetail(index, instant = false) {
    const floorIndex = clamp(Math.trunc(Number(index)), 0, 3);
    state.mode = 'detail';
    state.detailFloor = floorIndex;
    state.selected = floorIndex;

    // A detail view is always shown at the actual floor level.
    explosion = 0;
    explosionTarget = 0;
    updateExplosion(0, true);
    floorGroups.forEach((group, i) => {
      group.visible = i === floorIndex;
      FLOOR_DEFS[i].fadeTarget = i === floorIndex ? 1 : 0.16;
    });
    detailLayers.forEach((layer, i) => {
      if (layer) layer.root.visible = i === floorIndex;
    });
    if (selectionToast) selectionToast.classList.remove('visible');
    hideEquipmentTip();

    applyModeChrome('detail', floorIndex);
    applyLayers();
    syncExplodeUI();
    syncFloorButtons();
    goView('iso', instant);
  }

  function activateFrame(instant = false) {
    state.mode = 'frame';
    state.selected = null;
    explosionTarget = state.exploded ? 1 : 0;
    if (instant) {
      explosion = explosionTarget;
      updateExplosion(0, true);
    }
    floorGroups.forEach((group) => { group.visible = true; });
    detailLayers.forEach((layer) => {
      if (layer) layer.root.visible = false;
    });
    FLOOR_DEFS.forEach((floor) => { floor.fadeTarget = 1; });
    if (selectionToast) selectionToast.classList.remove('visible');
    hideEquipmentTip();

    applyModeChrome('frame', state.detailFloor);
    applyLayers();
    syncExplodeUI();
    syncFloorButtons();
    goView('iso', instant);
  }

  function applyWireMode() {
    solidMeshes.forEach((mesh) => {
      if (!mesh.material) return;
      mesh.material.wireframe = state.wire;
    });
  }

  function pickFloor(clientX, clientY) {
    if (!camera || !raycaster) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // In a floor-detail view only the active floor is interactive; upper
    // hidden floor groups are still raycastable, so do not pass them in.
    const targets = state.mode === 'detail' ? [slabMeshes[state.detailFloor]] : slabMeshes;
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const floorIndex = hits[0].object.userData.floorIndex;
    return Number.isInteger(floorIndex) ? floorIndex : null;
  }

  function pickTwoFEquipment(clientX, clientY) {
    if (!camera || !raycaster || !twoFPickables.length) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(twoFPickables, false);
    return hits.length ? hits[0].object.userData.equipment : null;
  }

  function showEquipmentTip(info, clientX, clientY) {
    const tip = $('#equipmentTip');
    if (!tip) return;
    tip.style.setProperty('--tip-color', info.color || '#6fc7c1');
    tip.innerHTML = `<span class="tip-kicker">${info.zone} / ${info.groupName}</span><strong>${info.name}</strong><small>${info.sub}</small>`;
    tip.classList.add('visible');
    const rect = tip.getBoundingClientRect();
    let x = clientX + 16;
    let y = clientY + 16;
    if (x + rect.width > window.innerWidth - 16) x = clientX - rect.width - 16;
    if (y + rect.height > window.innerHeight - 16) y = clientY - rect.height - 16;
    x = Math.max(12, Math.min(x, window.innerWidth - rect.width - 12));
    y = Math.max(12, Math.min(y, window.innerHeight - rect.height - 12));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideEquipmentTip() {
    const tip = $('#equipmentTip');
    if (tip) tip.classList.remove('visible');
  }

  function goView(name = 'iso', instant = false) {
    if (!camera || !controls) return;
    let views = FRAME_VIEWS;
    if (state.mode === 'detail') {
      const level = FLOOR_DEFS[state.detailFloor].level;
      views = {
        iso: { pos: [-112, level + 185, 150], target: [7, level + 1.5, 3] },
        front: { pos: [7, level + 48, 215], target: [7, level + 2, 2] },
        side: { pos: [220, level + 48, 0], target: [0, level + 2, 2] },
        top: { pos: [7, level + 250, 0.1], target: [7, level, 0] },
      };
    }
    const preset = views[name] || views.iso;
    const toPos = new THREE.Vector3(...preset.pos);
    const toTarget = new THREE.Vector3(...preset.target);

    $$('#viewGrid .view-btn, .dock-btn[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === name);
    });

    if (instant) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      cameraAnim = null;
      return;
    }

    cameraAnim = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      start: performance.now(),
      duration: name === 'top' ? 900 : 760,
      name,
    };
  }

  function resetScene() {
    if (state.mode === 'detail') {
      goView('iso');
      return;
    }
    state.selected = null;
    syncFloorButtons();
    state.exploded = true;
    explosionTarget = 1;
    syncExplodeUI();
    goView('iso');
  }

  function bindKeys() {
    window.addEventListener('keydown', (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'r') resetScene();
      if (key === 'e' && state.mode === 'frame') {
        state.exploded = !state.exploded;
        explosionTarget = state.exploded ? 1 : 0;
        syncExplodeUI();
      }
      if (key === '1') activateDetail(0);
      if (key === '2') activateDetail(1);
      if (key === '3') activateDetail(2);
      if (key === '4') activateDetail(3);
      if (key === '0' || key === '`') activateFrame();
    });
  }

  function updateExplosion(dt, force = false) {
    if (!force && Math.abs(explosionTarget - explosion) < 0.0001) return;
    explosion = force ? explosionTarget : damp(explosion, explosionTarget, 4.6, dt);
    if (Math.abs(explosion - explosionTarget) < 0.001) explosion = explosionTarget;

    floorGroups.forEach((group, i) => {
      group.position.y = FLOOR_DEFS[i].level + i * EXPLODE_RISE * explosion;
    });
  }

  function updateFades(dt) {
    floorGroups.forEach((group, i) => {
      const floor = FLOOR_DEFS[i];
      floor.fade = damp(floor.fade, floor.fadeTarget, 7.0, dt);
      if (Math.abs(floor.fade - floor.fadeTarget) < 0.002) floor.fade = floor.fadeTarget;

      fadeSets.forEach((item) => {
        if (item.floor !== floor) return;
        const opacity = item.baseOpacity * floor.fade;
        item.material.opacity = opacity;
        if (!item.noDepthWrite && 'depthWrite' in item.material) {
          item.material.depthWrite = opacity > 0.58;
        }
      });
    });
  }

  function updateCamera(dt) {
    if (!cameraAnim) {
      if (controls) controls.autoRotate = state.autoRotate;
      return;
    }
    const elapsed = (performance.now() - cameraAnim.start) / cameraAnim.duration;
    const t = easeOutCubic(clamp(elapsed, 0, 1));
    camera.position.lerpVectors(cameraAnim.fromPos, cameraAnim.toPos, t);
    controls.target.lerpVectors(cameraAnim.fromTarget, cameraAnim.toTarget, t);
    controls.autoRotate = false;
    if (elapsed >= 1) {
      cameraAnim = null;
      controls.autoRotate = state.autoRotate;
    }
  }

  function animate(now) {
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    const t = now || performance.now();
    const dt = Math.min((t - lastTime) / 1000 || 0.016, 0.05);
    lastTime = t;

    updateExplosion(dt);
    updateFades(dt);
    updateCamera(dt);
    if (controls) controls.update();
    updateZoneTags();
    renderer.render(scene, camera);
  }

  window.addEventListener('error', (event) => {
    fail(event.message || '页面脚本执行失败。');
  });
  window.addEventListener('unhandledrejection', (event) => {
    fail(event.reason && event.reason.message ? event.reason.message : '页面异步任务失败。');
  });

  try {
    init();
  } catch (error) {
    console.error(error);
    fail(error.message);
  }
})();
