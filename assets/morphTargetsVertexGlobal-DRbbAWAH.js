import{o as e}from"./index-C5g0_tJ2.js";import{t}from"./shaderStore-DaxFGScJ.js";var n=e({morphTargetsVertexGlobalWGSL:()=>a}),r=`morphTargetsVertexGlobal`,i=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
var vertexID : f32;
#endif
#endif
`;t.IncludesShadersStoreWGSL[r]||(t.IncludesShadersStoreWGSL[r]=i);var a={name:r,shader:i};export{n as t};