import{A as e,j as t}from"./index-BeybCgn5.js";import{t as n}from"./thumbnailOcclusion-Dq7SNB76.js";var r=`
struct Params { forward: vec4f, right: vec4f, up: vec4f, sheet: vec4f, target: vec4f, cover0: vec4f, cover1: vec4f, radii: vec4f }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var sheet: texture_2d<f32>;
fn position(index: u32, depth: f32) -> vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, depth, 1.0);
}
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return position(index, 0.5); }
@vertex fn maskVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return position(index, 0.0); }
fn inside(pos: vec2f, box: vec4f, radius: f32) -> bool {
  let q = max(abs(pos - box.xy - box.zw * 0.5) - box.zw * 0.5 + vec2f(radius), vec2f(0.0));
  return box.z > 0.0 && box.w > 0.0 && dot(q, q) <= radius * radius;
}
@fragment fn mask(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  if (!inside(pos.xy, p.cover0, p.radii.x) && !inside(pos.xy, p.cover1, p.radii.y)) { discard; }
  return vec4f(0.0);
}
@fragment fn fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let xy = pos.xy / p.target.xy;
  let ray = p.forward.xyz + p.right.xyz * (2.0 * xy.x - 1.0) + p.up.xyz * (1.0 - 2.0 * xy.y);
  let a = abs(ray);
  var face: f32; var along: f32; var sc: f32; var tc: f32;
  if (a.x >= a.y && a.x >= a.z) {
    face = select(1.0, 0.0, ray.x >= 0.0); along = a.x;
    sc = select(ray.y, -ray.y, ray.x >= 0.0); tc = ray.z;
  } else if (a.y >= a.z) {
    face = select(3.0, 2.0, ray.y >= 0.0); along = a.y;
    sc = select(-ray.x, ray.x, ray.y >= 0.0); tc = ray.z;
  } else {
    face = select(5.0, 4.0, ray.z >= 0.0); along = a.z;
    sc = ray.x; tc = select(ray.y, -ray.y, ray.z >= 0.0);
  }
  let uv = clamp(vec2f(sc / along + 1.0, 1.0 - tc / along) * 0.5, vec2f(0.0), vec2f(1.0));
  let texel = vec2i(floor(p.sheet.xy + vec2f(face * p.sheet.z, 0.0) + uv * (p.sheet.z - 1.0) + 0.5));
  return vec4f(textureLoad(sheet, texel, 0).rgb, 1.0);
}`;async function i(i,a){let o=a._device;if(!a.isWebGPU||!o)throw Error(`No host WebGPU device`);let s=i.createElement(`canvas`),c=s.getContext(`webgpu`);if(!c)throw Error(`WebGPU canvas unavailable`);let l=i.defaultView.navigator.gpu.getPreferredCanvasFormat();c.configure({device:o,format:l,alphaMode:`opaque`});let u=null;try{let i=o.createShaderModule({label:`scene-thumbnail`,code:r}),a=await o.createRenderPipelineAsync({label:`scene-thumbnail`,layout:`auto`,vertex:{module:i,entryPoint:`vertex`},fragment:{module:i,entryPoint:`fragment`,targets:[{format:l}]},primitive:{topology:`triangle-list`},depthStencil:{format:`depth24plus`,depthWriteEnabled:!1,depthCompare:`less`}}),d=await o.createRenderPipelineAsync({label:`scene-thumbnail-occlusion`,layout:o.createPipelineLayout({bindGroupLayouts:[a.getBindGroupLayout(0)]}),vertex:{module:i,entryPoint:`maskVertex`},fragment:{module:i,entryPoint:`mask`,targets:[{format:l,writeMask:0}]},primitive:{topology:`triangle-list`},depthStencil:{format:`depth24plus`,depthWriteEnabled:!0,depthCompare:`always`}});u=o.createBuffer({label:`scene-thumbnail-camera`,size:128,usage:e.Uniform|e.CopyDst,mappedAtCreation:!1});let f=u,p=new Map,m=null,h={dead:!1,lost:!1,listeners:new Set},g=new WeakRef(h);return o.lost.then(()=>{let e=g.deref();if(e&&!e.dead){e.lost=!0;for(let t of[...e.listeners])t()}}),{upload(e){if(h.dead||h.lost)throw Error(`Thumbnail device unavailable`);let n=o.createTexture({label:`scene-thumbnail-sheet`,size:[e.naturalWidth,e.naturalHeight,1],format:`rgba8unorm`,usage:t.TextureBinding|t.CopyDst|t.RenderAttachment});try{return o.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:n,colorSpace:`srgb`},[e.naturalWidth,e.naturalHeight,1]),p.set(n,o.createBindGroup({layout:a.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:f}},{binding:1,resource:n.createView()}]})),n}catch(e){throw n.destroy(),e}},draw(e,r,i,l){if(h.dead||h.lost)throw Error(`Thumbnail device unavailable`);(!m||s.width!==i||s.height!==l)&&(m?.destroy(),s.width=i,s.height=l,m=o.createTexture({label:`scene-thumbnail-depth`,size:[i,l,1],format:`depth24plus`,usage:t.RenderAttachment})),o.queue.writeBuffer(f,0,r);let u=o.createCommandEncoder({label:`scene-thumbnail-frame`}),g=u.beginRenderPass({colorAttachments:[{view:c.getCurrentTexture().createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:1}}],depthStencilAttachment:{view:m.createView(),depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`discard`}});g.setBindGroup(0,p.get(e));let _=n(r,i,l);return _&&(g.setScissorRect(..._),g.setPipeline(d),g.draw(3),g.setScissorRect(0,0,i,l)),g.setPipeline(a),g.draw(3),g.end(),o.queue.submit([u.finish()]),s},release(e){p.delete(e),e.destroy()},onLost(e){return h.listeners.add(e),()=>h.listeners.delete(e)},destroy(){h.dead||(h.dead=!0,h.listeners.clear(),p.clear(),m?.destroy(),f.destroy(),c.unconfigure(),s.width=s.height=0)}}}catch(e){throw u?.destroy(),c.unconfigure(),e}}export{i as createWebGpuThumbnailStage};