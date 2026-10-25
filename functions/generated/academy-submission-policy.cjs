// Generated canonical portfolio fields and educational review rubric.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/features/academy/submissionPolicy.ts
var submissionPolicy_exports = {};
__export(submissionPolicy_exports, {
  academyPortfolioStages: () => academyPortfolioStages,
  academyReviewRubric: () => academyReviewRubric
});
module.exports = __toCommonJS(submissionPolicy_exports);

// src/features/academy/portfolio.ts
var longField = (id, label, prompt, placeholder) => ({
  id,
  label,
  prompt,
  placeholder,
  kind: "long"
});
var academyPortfolioStages = [
  {
    id: 1,
    milestoneChapter: 5,
    chapterRange: [1, 5],
    eyebrow: "CH\u1EB6NG 1 \xB7 HI\u1EC2U N\u1EC0N T\u1EA2NG",
    title: "B\u1EA3n \u0111\u1ED3 n\u1EC1n t\u1EA3ng",
    description: "Gh\xE9p n\u0103m b\xE0i th\u1EF1c h\xE0nh \u0111\u1EA7u ti\xEAn th\xE0nh m\u1ED9t b\u1EA3n \u0111\u1ED3 \u0111\u1EE7 r\xF5 \u0111\u1EC3 quan s\xE1t c\u01A1 th\u1EC3 m\xE0 kh\xF4ng t\u1EF1 ph\xE1n x\xE9t ho\u1EB7c t\u1EF1 ch\u1EA9n \u0111o\xE1n.",
    outcome: "M\u1ED9t b\u1EA3n \u0111\u1ED3 g\u1ED3m m\u1EABu h\xECnh ch\xEDnh, \u0111i\u1EC3m g\xE3y, d\u1EEF li\u1EC7u n\u1EC1n, gi\u1EDBi h\u1EA1n an to\xE0n v\xE0 th\u1EED nghi\u1EC7m nh\u1ECF ti\u1EBFp theo.",
    fields: [
      longField("foundation-pattern", "M\u1EABu h\xECnh \u0111ang l\u1EB7p l\u1EA1i", "\u0110i\u1EC1u g\xEC xu\u1EA5t hi\u1EC7n nhi\u1EC1u l\u1EA7n trong b\u1EEFa \u0103n, n\u0103ng l\u01B0\u1EE3ng, n\u01B0\u1EDBc ho\u1EB7c ti\xEAu h\xF3a?", "Vi\u1EBFt m\u1ED9t m\u1EABu h\xECnh c\xF3 th\u1EDDi \u0111i\u1EC3m v\xE0 b\u1ED1i c\u1EA3nh c\u1EE5 th\u1EC3\u2026"),
      longField("foundation-friction", "\u0110i\u1EC3m g\xE3y quan tr\u1ECDng nh\u1EA5t", "Ma s\xE1t n\xE0o \u0111ang l\xE0m l\u1EF1a ch\u1ECDn mong mu\u1ED1n kh\xF3 x\u1EA3y ra nh\u1EA5t?", "Ch\u1ECDn m\u1ED9t \u0111i\u1EC3m g\xE3y, kh\xF4ng li\u1EC7t k\xEA to\xE0n b\u1ED9 v\u1EA5n \u0111\u1EC1\u2026"),
      longField("foundation-baseline", "D\u1EEF li\u1EC7u n\u1EC1n t\u1ED1i thi\u1EC3u", "B\u1EA1n s\u1EBD gi\u1EEF l\u1EA1i t\u1ED1i \u0111a b\u1ED1n t\xEDn hi\u1EC7u n\xE0o \u0111\u1EC3 \u0111\u1ECDc xu h\u01B0\u1EDBng?", "V\xED d\u1EE5: gi\u1EDD \u0103n, m\u1EE9c \u0111\xF3i, nh\u1ECBp u\u1ED1ng, tri\u1EC7u ch\u1EE9ng c\xF3 c\u1EA5u tr\xFAc\u2026"),
      longField("foundation-safety", "Ranh gi\u1EDBi an to\xE0n", "T\xEDn hi\u1EC7u n\xE0o khi\u1EBFn b\u1EA1n d\u1EEBng t\u1EF1 th\u1EED v\xE0 h\u1ECFi \u0111\xFAng chuy\xEAn m\xF4n?", "Ghi r\xF5 d\u1EA5u hi\u1EC7u v\xE0 ng\u01B0\u1EDDi/k\xEAnh c\u1EA7n li\xEAn h\u1EC7\u2026"),
      longField("foundation-next", "Th\u1EED nghi\u1EC7m nh\u1ECF ti\u1EBFp theo", "B\u1EA1n s\u1EBD \u0111\u1ED5i \u0111\xFAng m\u1ED9t bi\u1EBFn n\xE0o, trong bao l\xE2u?", "N\xEAu h\xE0nh \u0111\u1ED9ng, phi\xEAn b\u1EA3n ng\xE0y b\u1EADn v\xE0 th\u1EDDi gian th\u1EED\u2026"),
      longField("foundation-reflection", "\u0110i\u1EC1u t\xF4i hi\u1EC3u kh\xE1c \u0111i", "Sau ch\u1EB7ng n\xE0y, c\xE1ch nh\xECn n\xE0o c\u1EE7a b\u1EA1n v\u1EC1 dinh d\u01B0\u1EE1ng \u0111\xE3 thay \u0111\u1ED5i?", "T\u1EF1 di\u1EC5n \u0111\u1EA1t b\u1EB1ng l\u1EDDi c\u1EE7a b\u1EA1n\u2026")
    ]
  },
  {
    id: 2,
    milestoneChapter: 10,
    chapterRange: [6, 10],
    eyebrow: "CH\u1EB6NG 2 \xB7 C\xC1 NH\xC2N H\xD3A",
    title: "Dashboard c\xE1 nh\xE2n h\xF3a",
    description: "Bi\u1EBFn d\u1EEF li\u1EC7u th\xE0nh m\u1ED9t b\u1EA3ng \u0111i\u1EC1u khi\u1EC3n nh\u1EB9, gi\xFAp ra quy\u1EBFt \u0111\u1ECBnh theo xu h\u01B0\u1EDBng thay v\xEC ph\u1EA3n \u1EE9ng v\u1EDBi m\u1ED9t l\u1EA7n c\xE2n ho\u1EB7c m\u1ED9t ng\xE0y l\u1EC7ch.",
    outcome: "M\u1ED9t dashboard t\u1ED1i \u0111a b\u1ED1n ch\u1EC9 s\u1ED1, c\xF3 \u0111\u01B0\u1EDDng c\u01A1 s\u1EDF, nh\u1ECBp r\xE0 v\xE0 quy t\u1EAFc gi\u1EEF/ch\u1EC9nh/d\u1EEBng.",
    fields: [
      longField("dashboard-purpose", "C\xE2u h\u1ECFi dashboard c\u1EA7n tr\u1EA3 l\u1EDDi", "Quy\u1EBFt \u0111\u1ECBnh th\u1EF1c t\u1EBF n\xE0o b\u1EA1n mu\u1ED1n dashboard h\u1ED7 tr\u1EE3?", "V\xED d\u1EE5: k\u1EBF ho\u1EA1ch hi\u1EC7n t\u1EA1i c\xF3 c\xF2n ph\xF9 h\u1EE3p v\u1EDBi m\u1EE5c ti\xEAu v\xE0 tr\u1EA3i nghi\u1EC7m kh\xF4ng?"),
      longField("dashboard-signals", "T\u1ED1i \u0111a b\u1ED1n t\xEDn hi\u1EC7u", "Ch\u1ECDn k\u1EBFt qu\u1EA3, h\xE0nh vi, tr\u1EA3i nghi\u1EC7m v\xE0 an to\xE0n khi ph\xF9 h\u1EE3p.", "Ghi t\xEAn ch\u1EC9 s\u1ED1 v\xE0 v\xEC sao m\u1ED7i ch\u1EC9 s\u1ED1 c\u1EA7n thi\u1EBFt\u2026"),
      longField("dashboard-baseline", "\u0110\u01B0\u1EDDng c\u01A1 s\u1EDF v\xE0 c\xE1ch \u0111o", "\u0110o v\xE0o th\u1EDDi \u0111i\u1EC3m n\xE0o, t\u1EA7n su\u1EA5t n\xE0o v\xE0 sai s\u1ED1 n\xE0o c\u1EA7n nh\u1EDB?", "Chu\u1EA9n h\xF3a \u0111i\u1EC1u ki\u1EC7n \u0111o v\xE0 ghi kho\u1EA3ng dao \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng\u2026"),
      longField("dashboard-rule", "Quy t\u1EAFc ra quy\u1EBFt \u0111\u1ECBnh", "Khi n\xE0o gi\u1EEF, ch\u1EC9nh m\u1ED9t bi\u1EBFn, d\u1EEBng ho\u1EB7c h\u1ECFi chuy\xEAn m\xF4n?", "Vi\u1EBFt \u0111i\u1EC1u ki\u1EC7n \u0111\u1EE7 r\xF5 \u0111\u1EC3 kh\xF4ng \u0111\u1ED5i k\u1EBF ho\u1EA1ch theo c\u1EA3m x\xFAc\u2026"),
      longField("dashboard-review", "Nh\u1ECBp r\xE0", "Bao l\xE2u b\u1EA1n s\u1EBD \u0111\u1ECDc xu h\u01B0\u1EDBng v\xE0 ai c\u1EA7n tham gia n\u1EBFu c\xF3 c\u1EDD \u0111\u1ECF?", "Ch\u1ECDn m\u1ED9t nh\u1ECBp r\xE0 ph\xF9 h\u1EE3p v\u1EDBi t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i\u2026"),
      longField("dashboard-reflection", "\u0110i\u1EC1u d\u1EEF li\u1EC7u ch\u01B0a th\u1EC3 n\xF3i", "Gi\u1EDBi h\u1EA1n quan tr\u1ECDng nh\u1EA5t c\u1EE7a dashboard n\xE0y l\xE0 g\xEC?", "Ghi m\u1ED9t \u0111i\u1EC1u b\u1EA1n s\u1EBD kh\xF4ng k\u1EBFt lu\u1EADn ch\u1EC9 t\u1EEB c\xE1c ch\u1EC9 s\u1ED1 tr\xEAn\u2026")
    ]
  },
  {
    id: 3,
    milestoneChapter: 15,
    chapterRange: [11, 15],
    eyebrow: "CH\u1EB6NG 3 \xB7 \u0102N CHO M\u1EE4C TI\xCAU",
    title: "K\u1EBF ho\u1EA1ch theo m\u1EE5c ti\xEAu",
    description: "Gh\xE9p dinh d\u01B0\u1EE1ng quanh bu\u1ED5i t\u1EADp, ph\u1EE5c h\u1ED3i v\xE0 m\u1EE5c ti\xEAu h\xECnh th\u1EC3 th\xE0nh m\u1ED9t block c\xF3 th\u1EC3 th\u1EED, \u0111o v\xE0 \u0111i\u1EC1u ch\u1EC9nh.",
    outcome: "M\u1ED9t block 4\u20138 tu\u1EA7n c\xF3 m\u1EE5c ti\xEAu, giao th\u1EE9c b\u1EEFa \u0103n, ph\u1EE5c h\u1ED3i, k\xEAnh \u0111o v\xE0 \u0111i\u1EC1u ki\u1EC7n \u0111\u1ED5i h\u01B0\u1EDBng.",
    fields: [
      longField("goal-north-star", "M\u1EE5c ti\xEAu v\xE0 Sao B\u1EAFc \u0110\u1EA9u", "\u0110i\u1EC1u g\xEC quan tr\u1ECDng h\u01A1n con s\u1ED1 c\xE2n n\u1EB7ng trong block n\xE0y?", "N\xEAu k\u1EBFt qu\u1EA3 mong mu\u1ED1n v\xE0 m\u1ED9t tr\u1EA3i nghi\u1EC7m c\u1EA7n b\u1EA3o v\u1EC7\u2026"),
      longField("goal-training-profile", "H\u1ED3 s\u01A1 t\u1EADp luy\u1EC7n", "Lo\u1EA1i bu\u1ED5i, th\u1EDDi l\u01B0\u1EE3ng, c\u01B0\u1EDDng \u0111\u1ED9 v\xE0 th\u1EDDi \u0111i\u1EC3m n\xE0o c\u1EA7n \u0111\u01B0\u1EE3c ph\u1EE5c v\u1EE5?", "M\xF4 t\u1EA3 l\u1ECBch t\u1EADp th\u1EADt, kh\xF4ng d\xF9ng m\u1ED9t ng\xE0y l\xFD t\u01B0\u1EDFng\u2026"),
      longField("goal-fueling", "Giao th\u1EE9c tr\u01B0\u1EDBc \xB7 trong \xB7 sau t\u1EADp", "C\xE1c l\u1EF1a ch\u1ECDn m\u1EB7c \u0111\u1ECBnh v\xE0 ph\u01B0\u01A1ng \xE1n c\u1EE9u h\u1ED9 l\xE0 g\xEC?", "N\xEAu b\u1EEFa/\u0111\u1ED3 u\u1ED1ng d\u1EC5 th\u1EF1c hi\u1EC7n trong l\u1ECBch th\u1EADt\u2026"),
      longField("goal-recovery", "K\u1EBF ho\u1EA1ch ph\u1EE5c h\u1ED3i", "B\u1EA1n s\u1EBD b\u1EA3o v\u1EC7 n\u0103ng l\u01B0\u1EE3ng, protein, n\u01B0\u1EDBc v\xE0 gi\u1EA5c ng\u1EE7 th\u1EBF n\xE0o?", "Ch\u1ECDn tr\u1EE5 y\u1EBFu nh\u1EA5t v\xE0 h\xE0nh \u0111\u1ED9ng \u01B0u ti\xEAn\u2026"),
      longField("goal-measures", "B\u1ED1n k\xEAnh \u0111o", "K\u1EBFt qu\u1EA3, hi\u1EC7u su\u1EA5t, tr\u1EA3i nghi\u1EC7m v\xE0 an to\xE0n s\u1EBD \u0111\u01B0\u1EE3c \u0111\u1ECDc ra sao?", "Ghi t\xEDn hi\u1EC7u, t\u1EA7n su\u1EA5t v\xE0 c\xE1ch \u0111\u1ECDc xu h\u01B0\u1EDBng\u2026"),
      longField("goal-pivot", "\u0110i\u1EC1u ki\u1EC7n \u0111\u1ED5i h\u01B0\u1EDBng", "Khi n\xE0o ti\u1EBFp t\u1EE5c, t\xE1ch giai \u0111o\u1EA1n, gi\u1EA3m t\u1EA3i ho\u1EB7c d\u1EEBng?", "\u0110\u1EB7t ng\xE0y r\xE0 v\xE0 c\u1EDD \u0111\u1ECF c\u1EA7n chuy\u1EC3n tuy\u1EBFn\u2026")
    ]
  },
  {
    id: 4,
    milestoneChapter: 20,
    chapterRange: [16, 20],
    eyebrow: "CH\u1EB6NG 4 \xB7 T\u1EF0 CH\u1EE6 B\u1EC0N V\u1EEENG",
    title: "H\u1EC7 \u0111i\u1EC1u h\xE0nh dinh d\u01B0\u1EE1ng 1.0",
    description: "B\u1EA3n t\u1ED1t nghi\u1EC7p \u0111\u1EC3 b\u1EA1n t\u1EF1 quan s\xE1t, ra quy\u1EBFt \u0111\u1ECBnh r\u1EE7i ro th\u1EA5p v\xE0 bi\u1EBFt l\xFAc n\xE0o c\u1EA7n g\u1ECDi \u0111\xFAng ng\u01B0\u1EDDi h\u1ED7 tr\u1EE3.",
    outcome: "M\u1ED9t h\u1EC7 \u0111i\u1EC1u h\xE0nh c\xE1 nh\xE2n g\u1ED3m Sao B\u1EAFc \u0110\u1EA9u, b\u1EEFa m\u1EB7c \u0111\u1ECBnh, h\u1ED9 chi\u1EBFu an to\xE0n, dashboard, th\u1EED nghi\u1EC7m v\xE0 m\u1EA1ng l\u01B0\u1EDBi h\u1ED7 tr\u1EE3.",
    fields: [
      longField("os-north-star", "Sao B\u1EAFc \u0110\u1EA9u", "Gi\xE1 tr\u1ECB s\u1EE9c kh\u1ECFe v\xE0 cu\u1ED9c s\u1ED1ng n\xE0o d\u1EABn \u0111\u01B0\u1EDDng cho quy\u1EBFt \u0111\u1ECBnh dinh d\u01B0\u1EE1ng?", "Vi\u1EBFt m\u1ED9t c\xE2u \u0111\u1EE7 ng\u1EAFn \u0111\u1EC3 d\xF9ng khi ph\u1EA3i l\u1EF1a ch\u1ECDn\u2026"),
      longField("os-default-meals", "Ba b\u1EEFa m\u1EB7c \u0111\u1ECBnh", "Ba khung b\u1EEFa n\xE0o ph\xF9 h\u1EE3p ng\xE0y th\u01B0\u1EDDng, ng\xE0y b\u1EADn v\xE0 khi \u0103n ngo\xE0i?", "Ghi theo ch\u1EE9c n\u0103ng \u0111\u1EC3 c\xF3 th\u1EC3 thay m\xF3n linh ho\u1EA1t\u2026"),
      longField("os-safety-passport", "H\u1ED9 chi\u1EBFu an to\xE0n", "Thu\u1ED1c, d\u1ECB \u1EE9ng, t\xECnh tr\u1EA1ng \u0111\u1EB7c bi\u1EC7t, c\u1EDD \u0111\u1ECF v\xE0 h\u01B0\u1EDBng d\u1EABn chuy\xEAn m\xF4n n\xE0o c\u1EA7n lu\xF4n \u0111\u01B0\u1EE3c nh\u1EDB?", "Ch\u1EC9 ghi th\xF4ng tin b\u1EA1n ch\u1EE7 \u0111\u1ED9ng mu\u1ED1n l\u01B0u trong portfolio\u2026"),
      longField("os-dashboard", "Dashboard t\u1ED1i gi\u1EA3n", "T\u1ED1i \u0111a b\u1ED1n t\xEDn hi\u1EC7u n\xE0o gi\xFAp b\u1EA1n bi\u1EBFt h\u1EC7 th\u1ED1ng c\xF2n ph\u1EE5c v\u1EE5 m\xECnh?", "N\xEAu c\xE1ch \u0111o, nh\u1ECBp \u0111\u1ECDc v\xE0 gi\u1EDBi h\u1EA1n di\u1EC5n gi\u1EA3i\u2026"),
      longField("os-experiment", "M\u1ED9t th\u1EED nghi\u1EC7m r\u1EE7i ro th\u1EA5p", "Bi\u1EBFn duy nh\u1EA5t, d\u1EEF li\u1EC7u, th\u1EDDi gian v\xE0 \u0111i\u1EC1u ki\u1EC7n d\u1EEBng l\xE0 g\xEC?", "Thi\u1EBFt k\u1EBF m\u1ED9t th\u1EED nghi\u1EC7m c\xF3 th\u1EC3 \u0111\u1EA3o ng\u01B0\u1EE3c v\xE0 ki\u1EC3m ch\u1EE9ng\u2026"),
      longField("os-network", "M\u1EA1ng l\u01B0\u1EDBi \u0111\xFAng ng\u01B0\u1EDDi", "Ai h\u1ED7 tr\u1EE3 th\xF3i quen, hu\u1EA5n luy\u1EC7n, dinh d\u01B0\u1EE1ng v\xE0 y khoa khi c\u1EA7n?", "Ghi vai tr\xF2 v\xE0 c\xE1ch li\xEAn h\u1EC7, kh\xF4ng c\u1EA7n \u0111\u01B0a d\u1EEF li\u1EC7u ri\xEAng t\u01B0 d\u01B0 th\u1EEBa\u2026"),
      longField("os-reflection", "Cam k\u1EBFt t\u1EF1 ch\u1EE7", "B\u1EA1n s\u1EBD l\xE0m g\xEC khi d\u1EEF li\u1EC7u m\u1EDBi kh\xF4ng kh\u1EDBp v\u1EDBi k\u1EBF ho\u1EA1ch c\u0169?", "M\xF4 t\u1EA3 c\xE1ch gi\u1EEF t\xF2 m\xF2, \u0111i\u1EC1u ch\u1EC9nh v\u1EEBa m\u1EE9c v\xE0 xin h\u1ED7 tr\u1EE3\u2026")
    ]
  }
];

// src/features/academy/submissionPolicy.ts
var academyReviewRubric = {
  version: 1,
  criteria: [
    { id: "data", label: "D\u1EEF li\u1EC7u v\xE0 b\u1ED1i c\u1EA3nh", levels: ["Thi\u1EBFu d\u1EEF ki\u1EC7n \u0111\u1EC3 hi\u1EC3u b\xE0i.", "C\xF3 d\u1EEF ki\u1EC7n nh\u01B0ng c\xF2n thi\u1EBFu b\u1ED1i c\u1EA3nh ho\u1EB7c gi\u1EDBi h\u1EA1n.", "D\u1EEF ki\u1EC7n, b\u1ED1i c\u1EA3nh v\xE0 gi\u1EDBi h\u1EA1n \u0111\u01B0\u1EE3c n\xEAu r\xF5."] },
    { id: "mechanism", label: "Di\u1EC5n gi\u1EA3i ki\u1EBFn th\u1EE9c", levels: ["C\xF3 suy lu\u1EADn ch\u01B0a c\xF3 c\u0103n c\u1EE9 ho\u1EB7c nh\u1EA7m c\u01A1 ch\u1EBF.", "Di\u1EC5n gi\u1EA3i nh\xECn chung ph\xF9 h\u1EE3p; c\u1EA7n l\xE0m r\xF5 m\u1ED9t s\u1ED1 li\xEAn k\u1EBFt.", "Li\xEAn k\u1EBFt ki\u1EBFn th\u1EE9c v\u1EDBi d\u1EEF ki\u1EC7n; ph\xE2n bi\u1EC7t quan s\xE1t v\xE0 suy lu\u1EADn."] },
    { id: "feasibility", label: "T\xEDnh kh\u1EA3 thi", levels: ["Ch\u01B0a c\xF3 b\u01B0\u1EDBc ti\u1EBFp theo c\xF3 th\u1EC3 th\u1EF1c hi\u1EC7n.", "C\xF3 b\u01B0\u1EDBc ti\u1EBFp theo nh\u01B0ng thi\u1EBFu c\xE1ch theo d\xF5i ho\u1EB7c ph\u01B0\u01A1ng \xE1n ng\xE0y b\u1EADn.", "B\u01B0\u1EDBc ti\u1EBFp theo r\xF5, v\u1EEBa s\u1EE9c v\xE0 c\xF3 c\xE1ch r\xE0 l\u1EA1i."] },
    { id: "safety", label: "Gi\u1EDBi h\u1EA1n an to\xE0n", levels: ["C\xF2n nguy c\u01A1 ho\u1EB7c v\u01B0\u1EE3t ph\u1EA1m vi gi\xE1o d\u1EE5c c\u1EA7n s\u1EEDa.", "Nh\u1EADn di\u1EC7n gi\u1EDBi h\u1EA1n ch\xEDnh; c\u1EA7n b\u1ED5 sung c\xE1ch t\xECm h\u1ED7 tr\u1EE3.", "N\xEAu r\xF5 gi\u1EDBi h\u1EA1n, \u0111i\u1EC1u ki\u1EC7n d\u1EEBng v\xE0 \u0111\xFAng ng\u01B0\u1EDDi c\u1EA7n h\u1ECFi."] }
  ]
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  academyPortfolioStages,
  academyReviewRubric
});
