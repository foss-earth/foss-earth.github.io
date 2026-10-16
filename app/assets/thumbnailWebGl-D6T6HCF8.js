import{t as e}from"./thumbnailOcclusion-Dq7SNB76.js";var t=`attribute vec2 position; uniform float depth; void main(){ gl_Position=vec4(position,depth,1.); }`,n=`precision highp float;
uniform vec4 cover0, cover1, radii, target;
bool inside(vec2 pos, vec4 box, float radius) {
  vec2 q = max(abs(pos - box.xy - box.zw * .5) - box.zw * .5 + vec2(radius), vec2(0.));
  return box.z > 0. && box.w > 0. && dot(q, q) <= radius * radius;
}
void main(){
  vec2 pos = vec2(gl_FragCoord.x, target.y - gl_FragCoord.y);
  if (!inside(pos, cover0, radii.x) && !inside(pos, cover1, radii.y)) discard;
  gl_FragColor = vec4(0.);
}`,r=`
precision highp float;
uniform sampler2D sheet;
uniform vec4 forward, right, up, strip, target;
uniform vec2 sheetSize;
void main() {
  vec2 xy = vec2(gl_FragCoord.x, target.y - gl_FragCoord.y) / target.xy;
  vec3 ray = forward.xyz + right.xyz * (2. * xy.x - 1.) + up.xyz * (1. - 2. * xy.y);
  vec3 a = abs(ray);
  float face, along, sc, tc;
  if (a.x >= a.y && a.x >= a.z) {
    face = ray.x >= 0. ? 0. : 1.; along = a.x; sc = ray.x >= 0. ? -ray.y : ray.y; tc = ray.z;
  } else if (a.y >= a.z) {
    face = ray.y >= 0. ? 2. : 3.; along = a.y; sc = ray.y >= 0. ? ray.x : -ray.x; tc = ray.z;
  } else {
    face = ray.z >= 0. ? 4. : 5.; along = a.z; sc = ray.x; tc = ray.z >= 0. ? -ray.y : ray.y;
  }
  vec2 uv = clamp(vec2(sc / along + 1., 1. - tc / along) * .5, 0., 1.);
  vec2 texel = floor(strip.xy + vec2(face * strip.z, 0.) + uv * (strip.z - 1.) + .5);
  gl_FragColor = vec4(texture2D(sheet, (texel + .5) / sheetSize).rgb, 1.);
}`;function i(i){let a=i.createElement(`canvas`),o=a.getContext(`webgl`,{alpha:!1,antialias:!1,depth:!0,stencil:!1,preserveDrawingBuffer:!1});if(!o)throw Error(`WebGL preview unavailable`);let s=[],c=null,l=null,u=null;try{let i=(e,t)=>{let n=o.createShader(e);if(!n)throw Error(`Thumbnail shader allocation failed`);if(s.push(n),o.shaderSource(n,t),o.compileShader(n),!o.getShaderParameter(n,o.COMPILE_STATUS))throw Error(o.getShaderInfoLog(n)??`Thumbnail shader failed`);return n};if(c=o.createProgram(),!c)throw Error(`Thumbnail program allocation failed`);if(o.attachShader(c,i(o.VERTEX_SHADER,t)),o.attachShader(c,i(o.FRAGMENT_SHADER,r)),o.linkProgram(c),!o.getProgramParameter(c,o.LINK_STATUS))throw Error(o.getProgramInfoLog(c)??`Thumbnail shader link failed`);if(l=o.createProgram(),!l)throw Error(`Thumbnail mask allocation failed`);if(o.attachShader(l,i(o.VERTEX_SHADER,t)),o.attachShader(l,i(o.FRAGMENT_SHADER,n)),o.linkProgram(l),!o.getProgramParameter(l,o.LINK_STATUS))throw Error(o.getProgramInfoLog(l)??`Thumbnail mask failed`);o.useProgram(c),u=o.createBuffer(),o.bindBuffer(o.ARRAY_BUFFER,u),o.bufferData(o.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),o.STATIC_DRAW);let d=o.getAttribLocation(c,`position`);o.enableVertexAttribArray(d),o.vertexAttribPointer(d,2,o.FLOAT,!1,0,0);let f=[`forward`,`right`,`up`,`strip`,`target`].map(e=>o.getUniformLocation(c,e)),p=[`target`,`cover0`,`cover1`,`radii`].map(e=>o.getUniformLocation(l,e)),m=o.getAttribLocation(l,`position`),h=o.getUniformLocation(l,`depth`),g=o.getUniformLocation(c,`depth`),_=o.getUniformLocation(c,`sheetSize`),v=new Map,y=new Set,b=e=>{e.preventDefault();for(let e of[...y])e()};a.addEventListener(`webglcontextlost`,b);let x=!1;return{upload(e){let t=o.createTexture();if(!t)throw Error(`Thumbnail texture allocation failed`);try{if(o.bindTexture(o.TEXTURE_2D,t),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.NEAREST),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.NEAREST),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),o.pixelStorei(o.UNPACK_FLIP_Y_WEBGL,!1),o.texImage2D(o.TEXTURE_2D,0,o.RGBA,o.RGBA,o.UNSIGNED_BYTE,e),o.getError()!==o.NO_ERROR)throw Error(`Thumbnail upload failed`);return v.set(t,[e.naturalWidth,e.naturalHeight]),t}catch(e){throw o.deleteTexture(t),e}},draw(t,n,r,i){if(x||o.isContextLost())throw Error(`Thumbnail context lost`);a.width!==r&&(a.width=r),a.height!==i&&(a.height=i),o.viewport(0,0,r,i),o.enable(o.DEPTH_TEST),o.depthMask(!0),o.clearDepth(1),o.clear(o.DEPTH_BUFFER_BIT);let s=e(n,r,i);s&&(o.enable(o.SCISSOR_TEST),o.scissor(s[0],i-s[1]-s[3],s[2],s[3]),o.useProgram(l),o.uniform1f(h,-1),o.enableVertexAttribArray(m),o.vertexAttribPointer(m,2,o.FLOAT,!1,0,0),p.forEach((e,t)=>o.uniform4fv(e,n.subarray(16+t*4,20+t*4))),o.depthFunc(o.ALWAYS),o.colorMask(!1,!1,!1,!1),o.drawArrays(o.TRIANGLES,0,3)),o.disable(o.SCISSOR_TEST),o.useProgram(c),o.uniform1f(g,0),o.enableVertexAttribArray(d),o.vertexAttribPointer(d,2,o.FLOAT,!1,0,0),o.depthFunc(o.LESS),o.depthMask(!1),o.colorMask(!0,!0,!0,!0),o.bindTexture(o.TEXTURE_2D,t),f.forEach((e,t)=>o.uniform4fv(e,n.subarray(t*4,t*4+4)));let u=v.get(t);return o.uniform2f(_,u[0],u[1]),o.drawArrays(o.TRIANGLES,0,3),a},release(e){v.delete(e),o.deleteTexture(e)},onLost(e){return y.add(e),()=>y.delete(e)},destroy(){if(!x){x=!0,y.clear(),a.removeEventListener(`webglcontextlost`,b),o.deleteBuffer(u),o.deleteProgram(c),o.deleteProgram(l);for(let e of s)o.deleteShader(e);o.getExtension(`WEBGL_lose_context`)?.loseContext(),a.width=a.height=0}}}}catch(e){o.deleteBuffer(u),o.deleteProgram(c),o.deleteProgram(l);for(let e of s)o.deleteShader(e);throw o.getExtension(`WEBGL_lose_context`)?.loseContext(),e}}export{i as createWebGlThumbnailStage};