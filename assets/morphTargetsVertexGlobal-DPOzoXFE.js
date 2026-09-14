import{a as e}from"./index-9vX2kp0J.js";import{t}from"./shaderStore-DaxFGScJ.js";var n=e({morphTargetsVertexGlobal:()=>a}),r=`morphTargetsVertexGlobal`,i=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
float vertexID;
#endif
#endif
`;t.IncludesShadersStore[r]||(t.IncludesShadersStore[r]=i);var a={name:r,shader:i};export{n as t};