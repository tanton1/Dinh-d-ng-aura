// Generated draft catalog. Chapter metadata only; no lesson content or answer keys.
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

// src/features/academy/draftCatalog.ts
var draftCatalog_exports = {};
__export(draftCatalog_exports, {
  academyDraftChapterNumbers: () => academyDraftChapterNumbers,
  academyDraftCurriculumSize: () => academyDraftCurriculumSize
});
module.exports = __toCommonJS(draftCatalog_exports);
var academyDraftChapterNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
var academyDraftCurriculumSize = 20;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  academyDraftChapterNumbers,
  academyDraftCurriculumSize
});
