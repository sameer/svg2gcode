let R=0,P=null,X=`string`,$=796,U=`utf-8`,N=128,Z=4,Q=1,W=`function`,T=`undefined`,Y=`Object`,M=Array,V=Error,_=Object,S=Uint8Array,O=undefined;var p=(()=>{if(o===P||o.byteLength===R){o=new Int32Array(a.memory.buffer)};return o});var r=((a,b)=>{a=a>>>R;return q.decode(j().subarray(a,a+ b))});var K=(b=>{if(a!==O)return a;const c=H();I(c);if(!(b instanceof WebAssembly.Module)){b=new WebAssembly.Module(b)};const d=new WebAssembly.Instance(b,c);return J(d,b)});var G=(async(a,b)=>{if(typeof Response===W&&a instanceof Response){if(typeof WebAssembly.instantiateStreaming===W){try{return await WebAssembly.instantiateStreaming(a,b)}catch(b){if(a.headers.get(`Content-Type`)!=`application/wasm`){console.warn(`\`WebAssembly.instantiateStreaming\` failed because your server does not serve wasm with \`application/wasm\` MIME type. Falling back to \`WebAssembly.instantiate\` which is slower. Original error:\\n`,b)}else{throw b}}};const c=await a.arrayBuffer();return await WebAssembly.instantiate(c,b)}else{const c=await WebAssembly.instantiate(a,b);if(c instanceof WebAssembly.Instance){return {instance:c,module:a}}else{return c}}});var B=((c,d,e)=>{try{a._dyn_core__ops__function__FnMut___A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h74555206507b8cd1(c,d,w(e))}finally{b[v++]=O}});var J=((b,c)=>{a=b.exports;L.__wbindgen_wasm_module=c;o=P;D=P;i=P;a.__wbindgen_start();return a});var A=((b,c,d)=>{a._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h0aaf6ffb8748d22a(b,c,g(d))});var y=((b,c,d,e)=>{const f={a:b,b:c,cnt:Q,dtor:d};const g=(...b)=>{f.cnt++;try{return e(f.a,f.b,...b)}finally{if(--f.cnt===R){a.__wbindgen_export_2.get(f.dtor)(f.a,f.b);f.a=R}}};g.original=f;return g});var x=((c,d,e)=>{try{a.wasm_bindgen__convert__closures__invoke1_mut_ref__he5a69ce0d19dee17(c,d,w(e))}finally{b[v++]=O}});var s=(a=>{const b=typeof a;if(b==`number`||b==`boolean`||a==P){return `${a}`};if(b==X){return `"${a}"`};if(b==`symbol`){const b=a.description;if(b==P){return `Symbol`}else{return `Symbol(${b})`}};if(b==W){const b=a.name;if(typeof b==X&&b.length>R){return `Function(${b})`}else{return `Function`}};if(M.isArray(a)){const b=a.length;let c=`[`;if(b>R){c+=s(a[R])};for(let d=Q;d<b;d++){c+=`, `+ s(a[d])};c+=`]`;return c};const c=/\[object ([^\]]+)\]/.exec(toString.call(a));let d;if(c.length>Q){d=c[Q]}else{return toString.call(a)};if(d==Y){try{return `Object(`+ JSON.stringify(a)+ `)`}catch(a){return Y}};if(a instanceof V){return `${a.name}: ${a.message}\n${a.stack}`};return d});var I=((a,b)=>{});var t=((b,c,d,e)=>{const f={a:b,b:c,cnt:Q,dtor:d};const g=(...b)=>{f.cnt++;const c=f.a;f.a=R;try{return e(c,f.b,...b)}finally{if(--f.cnt===R){a.__wbindgen_export_2.get(f.dtor)(c,f.b)}else{f.a=c}}};g.original=f;return g});var n=(a=>a===O||a===P);var e=(a=>{if(a<132)return;b[a]=d;d=a});var u=((b,c)=>{a.wasm_bindgen__convert__closures__invoke0_mut__h89501ee4c1cd80ef(b,c)});var m=((a,b,c)=>{if(c===O){const c=k.encode(a);const d=b(c.length,Q)>>>R;j().subarray(d,d+ c.length).set(c);h=c.length;return d};let d=a.length;let e=b(d,Q)>>>R;const f=j();let g=R;for(;g<d;g++){const b=a.charCodeAt(g);if(b>127)break;f[e+ g]=b};if(g!==d){if(g!==R){a=a.slice(g)};e=c(e,d,d=g+ a.length*3,Q)>>>R;const b=j().subarray(e+ g,e+ d);const f=l(a,b);g+=f.written};h=g;return e});var F=((a,b)=>{a=a>>>R;const c=E();const d=c.subarray(a/Z,a/Z+ b);const e=[];for(let a=R;a<d.length;a++){e.push(f(d[a]))};return e});function C(b,c){try{return b.apply(this,c)}catch(b){a.__wbindgen_exn_store(g(b))}}var j=(()=>{if(i===P||i.byteLength===R){i=new S(a.memory.buffer)};return i});var H=(()=>{const b={};b.wbg={};b.wbg.__wbindgen_object_drop_ref=(a=>{f(a)});b.wbg.__wbindgen_cb_drop=(a=>{const b=f(a).original;if(b.cnt--==Q){b.a=R;return !0};const c=!1;return c});b.wbg.__wbindgen_object_clone_ref=(a=>{const b=c(a);return g(b)});b.wbg.__wbindgen_string_get=((b,d)=>{const e=c(d);const f=typeof e===X?e:O;var g=n(f)?R:m(f,a.__wbindgen_malloc,a.__wbindgen_realloc);var i=h;p()[b/Z+ Q]=i;p()[b/Z+ R]=g});b.wbg.__wbindgen_string_new=((a,b)=>{const c=r(a,b);return g(c)});b.wbg.__wbg_listenerid_6dcf1c62b7b7de58=((a,b)=>{const d=c(b).__yew_listener_id;p()[a/Z+ Q]=n(d)?R:d;p()[a/Z+ R]=!n(d)});b.wbg.__wbg_setlistenerid_f2e783343fa0cec1=((a,b)=>{c(a).__yew_listener_id=b>>>R});b.wbg.__wbg_cachekey_b81c1aacc6a0645c=((a,b)=>{const d=c(b).__yew_subtree_cache_key;p()[a/Z+ Q]=n(d)?R:d;p()[a/Z+ R]=!n(d)});b.wbg.__wbg_subtreeid_e80a1798fee782f9=((a,b)=>{const d=c(b).__yew_subtree_id;p()[a/Z+ Q]=n(d)?R:d;p()[a/Z+ R]=!n(d)});b.wbg.__wbg_setsubtreeid_e1fab6b578c800cf=((a,b)=>{c(a).__yew_subtree_id=b>>>R});b.wbg.__wbg_setcachekey_75bcd45312087529=((a,b)=>{c(a).__yew_subtree_cache_key=b>>>R});b.wbg.__wbg_new_abda76e883ba8a5f=(()=>{const a=new V();return g(a)});b.wbg.__wbg_stack_658279fe44541cf6=((b,d)=>{const e=c(d).stack;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_error_f851667af71bcfc6=((b,c)=>{let d;let e;try{d=b;e=c;console.error(r(b,c))}finally{a.__wbindgen_free(d,e,Q)}});b.wbg.__wbg_clearTimeout_541ac0980ffcef74=(a=>{const b=clearTimeout(f(a));return g(b)});b.wbg.__wbg_setTimeout_7d81d052875b0f4f=function(){return C(((a,b)=>{const d=setTimeout(c(a),b);return g(d)}),arguments)};b.wbg.__wbg_queueMicrotask_118eeb525d584d9a=(a=>{queueMicrotask(c(a))});b.wbg.__wbg_queueMicrotask_26a89c14c53809c0=(a=>{const b=c(a).queueMicrotask;return g(b)});b.wbg.__wbindgen_is_function=(a=>{const b=typeof c(a)===W;return b});b.wbg.__wbg_error_a526fb08a0205972=((b,c)=>{var d=F(b,c).slice();a.__wbindgen_free(b,c*Z,Z);console.error(...d)});b.wbg.__wbg_body_3eb73da919b867a1=(a=>{const b=c(a).body;return n(b)?R:g(b)});b.wbg.__wbg_createElement_1a136faad4101f43=function(){return C(((a,b,d)=>{const e=c(a).createElement(r(b,d));return g(e)}),arguments)};b.wbg.__wbg_createElementNS_d47e0c50fa2904e0=function(){return C(((a,b,d,e,f)=>{const h=c(a).createElementNS(b===R?O:r(b,d),r(e,f));return g(h)}),arguments)};b.wbg.__wbg_createTextNode_dbdd908f92bae1b1=((a,b,d)=>{const e=c(a).createTextNode(r(b,d));return g(e)});b.wbg.__wbg_instanceof_Element_f614cf57d4316979=(a=>{let b;try{b=c(a) instanceof Element}catch(a){b=!1}const d=b;return d});b.wbg.__wbg_namespaceURI_0819c2800784a176=((b,d)=>{const e=c(d).namespaceURI;var f=n(e)?R:m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);var g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_setinnerHTML_99deeacfff0ae4cc=((a,b,d)=>{c(a).innerHTML=r(b,d)});b.wbg.__wbg_outerHTML_69934f9195df65af=((b,d)=>{const e=c(d).outerHTML;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_removeAttribute_5c264e727b67dbdb=function(){return C(((a,b,d)=>{c(a).removeAttribute(r(b,d))}),arguments)};b.wbg.__wbg_setAttribute_0918ea45d5a1c663=function(){return C(((a,b,d,e,f)=>{c(a).setAttribute(r(b,d),r(e,f))}),arguments)};b.wbg.__wbg_instanceof_Window_99dc9805eaa2614b=(a=>{let b;try{b=c(a) instanceof Window}catch(a){b=!1}const d=b;return d});b.wbg.__wbg_document_5257b70811e953c0=(a=>{const b=c(a).document;return n(b)?R:g(b)});b.wbg.__wbg_localStorage_318b1c4f106a46f9=function(){return C((a=>{const b=c(a).localStorage;return n(b)?R:g(b)}),arguments)};b.wbg.__wbg_sessionStorage_8204bcaf5d97dd69=function(){return C((a=>{const b=c(a).sessionStorage;return n(b)?R:g(b)}),arguments)};b.wbg.__wbg_fetch_0117c27c9b3739e0=((a,b,d)=>{const e=c(a).fetch(r(b,d));return g(e)});b.wbg.__wbg_click_fb27a2d3b17c09c2=(a=>{c(a).click()});b.wbg.__wbg_checked_fae75426dd38619c=(a=>{const b=c(a).checked;return b});b.wbg.__wbg_setchecked_3b12f3d602a63e47=((a,b)=>{c(a).checked=b!==R});b.wbg.__wbg_files_0fe2affb0f600765=(a=>{const b=c(a).files;return n(b)?R:g(b)});b.wbg.__wbg_value_c93cb4b4d352228e=((b,d)=>{const e=c(d).value;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_setvalue_9bd3f93b3864ddbf=((a,b,d)=>{c(a).value=r(b,d)});b.wbg.__wbg_name_6c808ccae465f9e1=((b,d)=>{const e=c(d).name;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_readyState_44c24e9776f720b4=(a=>{const b=c(a).readyState;return b});b.wbg.__wbg_result_e515a9bf8390ef47=function(){return C((a=>{const b=c(a).result;return g(b)}),arguments)};b.wbg.__wbg_error_8d62cca0d82b0b36=(a=>{const b=c(a).error;return n(b)?R:g(b)});b.wbg.__wbg_new_b07bacad2380fbb9=function(){return C((()=>{const a=new FileReader();return g(a)}),arguments)};b.wbg.__wbg_abort_fa3a2ce39ab03e8d=(a=>{c(a).abort()});b.wbg.__wbg_readAsArrayBuffer_84f69d5bca819f0a=function(){return C(((a,b)=>{c(a).readAsArrayBuffer(c(b))}),arguments)};b.wbg.__wbg_readAsText_9f9d76c73fffd2d6=function(){return C(((a,b)=>{c(a).readAsText(c(b))}),arguments)};b.wbg.__wbg_value_ab23a75318ea828f=((b,d)=>{const e=c(d).value;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_setvalue_918a8ae77531a942=((a,b,d)=>{c(a).value=r(b,d)});b.wbg.__wbg_parentNode_f3957fdd408a62f7=(a=>{const b=c(a).parentNode;return n(b)?R:g(b)});b.wbg.__wbg_parentElement_86a7612dde875ba9=(a=>{const b=c(a).parentElement;return n(b)?R:g(b)});b.wbg.__wbg_childNodes_75d3da5f3a7bb985=(a=>{const b=c(a).childNodes;return g(b)});b.wbg.__wbg_lastChild_8f7b6f3825115eff=(a=>{const b=c(a).lastChild;return n(b)?R:g(b)});b.wbg.__wbg_nextSibling_13e9454ef5323f1a=(a=>{const b=c(a).nextSibling;return n(b)?R:g(b)});b.wbg.__wbg_setnodeValue_8656e865e9b11bbb=((a,b,d)=>{c(a).nodeValue=b===R?O:r(b,d)});b.wbg.__wbg_textContent_efe8338af53ddf62=((b,d)=>{const e=c(d).textContent;var f=n(e)?R:m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);var g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_cloneNode_80501c66ab115588=function(){return C((a=>{const b=c(a).cloneNode();return g(b)}),arguments)};b.wbg.__wbg_insertBefore_882082ef4c5d7766=function(){return C(((a,b,d)=>{const e=c(a).insertBefore(c(b),c(d));return g(e)}),arguments)};b.wbg.__wbg_removeChild_14b08321b677677a=function(){return C(((a,b)=>{const d=c(a).removeChild(c(b));return g(d)}),arguments)};b.wbg.__wbg_get_45a7f6330b64b39e=function(){return C(((b,d,e,f)=>{const g=c(d)[r(e,f)];var i=n(g)?R:m(g,a.__wbindgen_malloc,a.__wbindgen_realloc);var j=h;p()[b/Z+ Q]=j;p()[b/Z+ R]=i}),arguments)};b.wbg.__wbg_set_9702ee17e03291f5=function(){return C(((a,b,d,e,f)=>{c(a)[r(b,d)]=r(e,f)}),arguments)};b.wbg.__wbg_addEventListener_2f891d22985fd3c8=function(){return C(((a,b,d,e)=>{c(a).addEventListener(r(b,d),c(e))}),arguments)};b.wbg.__wbg_addEventListener_1b158e9e95e0ab00=function(){return C(((a,b,d,e,f)=>{c(a).addEventListener(r(b,d),c(e),c(f))}),arguments)};b.wbg.__wbg_removeEventListener_177ff96081e6f22d=function(){return C(((a,b,d,e,f)=>{c(a).removeEventListener(r(b,d),c(e),f!==R)}),arguments)};b.wbg.__wbg_debug_0207b724052e591d=((a,b,d,e)=>{console.debug(c(a),c(b),c(d),c(e))});b.wbg.__wbg_error_1f4e3e298a7c97f6=(a=>{console.error(c(a))});b.wbg.__wbg_error_8cf137381b3af25f=((a,b,d,e)=>{console.error(c(a),c(b),c(d),c(e))});b.wbg.__wbg_info_eb81e4fcae9ba8f1=((a,b,d,e)=>{console.info(c(a),c(b),c(d),c(e))});b.wbg.__wbg_log_bd0951a507fbf762=((a,b,d,e)=>{console.log(c(a),c(b),c(d),c(e))});b.wbg.__wbg_warn_ea08466617ec5d3a=((a,b,d,e)=>{console.warn(c(a),c(b),c(d),c(e))});b.wbg.__wbg_length_5f3530f0f1af8661=(a=>{const b=c(a).length;return b});b.wbg.__wbg_item_e09547f67fe7cfab=((a,b)=>{const d=c(a).item(b>>>R);return n(d)?R:g(d)});b.wbg.__wbg_url_47f8307501523859=((b,d)=>{const e=c(d).url;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_text_10c88c5e55f873c7=function(){return C((a=>{const b=c(a).text();return g(b)}),arguments)};b.wbg.__wbg_instanceof_ShadowRoot_cb6366cb0956ce29=(a=>{let b;try{b=c(a) instanceof ShadowRoot}catch(a){b=!1}const d=b;return d});b.wbg.__wbg_host_99e27ed8897850f2=(a=>{const b=c(a).host;return g(b)});b.wbg.__wbg_name_6b14f0bd14104364=((b,d)=>{const e=c(d).name;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_message_9cb2b2d345ff18c6=((b,d)=>{const e=c(d).message;const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbg_target_791826e938c3e308=(a=>{const b=c(a).target;return n(b)?R:g(b)});b.wbg.__wbg_bubbles_f0783dc095f8e220=(a=>{const b=c(a).bubbles;return b});b.wbg.__wbg_cancelBubble_191799b8e0ab3254=(a=>{const b=c(a).cancelBubble;return b});b.wbg.__wbg_composedPath_d94a39b8c8f6eed1=(a=>{const b=c(a).composedPath();return g(b)});b.wbg.__wbg_get_c43534c00f382c8a=((a,b)=>{const d=c(a)[b>>>R];return g(d)});b.wbg.__wbg_length_d99b680fd68bf71b=(a=>{const b=c(a).length;return b});b.wbg.__wbg_newnoargs_5859b6d41c6fe9f7=((a,b)=>{const c=new Function(r(a,b));return g(c)});b.wbg.__wbg_call_a79f1973a4f07d5e=function(){return C(((a,b)=>{const d=c(a).call(c(b));return g(d)}),arguments)};b.wbg.__wbg_new_87d841e70661f6e9=(()=>{const a=new _();return g(a)});b.wbg.__wbg_self_086b5302bcafb962=function(){return C((()=>{const a=self.self;return g(a)}),arguments)};b.wbg.__wbg_window_132fa5d7546f1de5=function(){return C((()=>{const a=window.window;return g(a)}),arguments)};b.wbg.__wbg_globalThis_e5f801a37ad7d07b=function(){return C((()=>{const a=globalThis.globalThis;return g(a)}),arguments)};b.wbg.__wbg_global_f9a61fce4af6b7c1=function(){return C((()=>{const a=global.global;return g(a)}),arguments)};b.wbg.__wbindgen_is_undefined=(a=>{const b=c(a)===O;return b});b.wbg.__wbg_from_a663e01d8dab8e44=(a=>{const b=M.from(c(a));return g(b)});b.wbg.__wbg_instanceof_ArrayBuffer_f4521cec1b99ee35=(a=>{let b;try{b=c(a) instanceof ArrayBuffer}catch(a){b=!1}const d=b;return d});b.wbg.__wbg_message_5dbdf59ed61bbc49=(a=>{const b=c(a).message;return g(b)});b.wbg.__wbg_new0_c0e40662db0749ee=(()=>{const a=new Date();return g(a)});b.wbg.__wbg_toISOString_8105abccb82c9562=(a=>{const b=c(a).toISOString();return g(b)});b.wbg.__wbg_is_a5728dbfb61c82cd=((a,b)=>{const d=_.is(c(a),c(b));return d});b.wbg.__wbg_instanceof_TypeError_559f0598cf3d056b=(a=>{let b;try{b=c(a) instanceof TypeError}catch(a){b=!1}const d=b;return d});b.wbg.__wbg_resolve_97ecd55ee839391b=(a=>{const b=Promise.resolve(c(a));return g(b)});b.wbg.__wbg_then_7aeb7c5f1536640f=((a,b)=>{const d=c(a).then(c(b));return g(d)});b.wbg.__wbg_then_5842e4e97f7beace=((a,b,d)=>{const e=c(a).then(c(b),c(d));return g(e)});b.wbg.__wbg_buffer_5d1b598a01b41a42=(a=>{const b=c(a).buffer;return g(b)});b.wbg.__wbg_new_ace717933ad7117f=(a=>{const b=new S(c(a));return g(b)});b.wbg.__wbg_set_74906aa30864df5a=((a,b,d)=>{c(a).set(c(b),d>>>R)});b.wbg.__wbg_length_f0764416ba5bb237=(a=>{const b=c(a).length;return b});b.wbg.__wbg_set_37a50e901587b477=function(){return C(((a,b,d)=>{const e=Reflect.set(c(a),c(b),c(d));return e}),arguments)};b.wbg.__wbindgen_debug_string=((b,d)=>{const e=s(c(d));const f=m(e,a.__wbindgen_malloc,a.__wbindgen_realloc);const g=h;p()[b/Z+ Q]=g;p()[b/Z+ R]=f});b.wbg.__wbindgen_throw=((a,b)=>{throw new V(r(a,b))});b.wbg.__wbindgen_memory=(()=>{const b=a.memory;return g(b)});b.wbg.__wbindgen_closure_wrapper1223=((a,b,c)=>{const d=t(a,b,$,u);return g(d)});b.wbg.__wbindgen_closure_wrapper1224=((a,b,c)=>{const d=t(a,b,$,x);return g(d)});b.wbg.__wbindgen_closure_wrapper1712=((a,b,c)=>{const d=y(a,b,970,z);return g(d)});b.wbg.__wbindgen_closure_wrapper1966=((a,b,c)=>{const d=t(a,b,1054,A);return g(d)});b.wbg.__wbindgen_closure_wrapper2005=((a,b,c)=>{const d=t(a,b,1077,B);return g(d)});return b});var E=(()=>{if(D===P||D.byteLength===R){D=new Uint32Array(a.memory.buffer)};return D});var L=(async(b)=>{if(a!==O)return a;if(typeof b===T){b=new URL(`svg2gcode-web_bg.wasm`,import.meta.url)};const c=H();if(typeof b===X||typeof Request===W&&b instanceof Request||typeof URL===W&&b instanceof URL){b=fetch(b)};I(c);const {instance:d,module:e}=await G(await b,c);return J(d,e)});var g=(a=>{if(d===b.length)b.push(b.length+ Q);const c=d;d=b[c];b[c]=a;return c});var f=(a=>{const b=c(a);e(a);return b});var z=((c,d,e)=>{try{a.wasm_bindgen__convert__closures__invoke1_ref__ha0976295ebeaac29(c,d,w(e))}finally{b[v++]=O}});var w=(a=>{if(v==Q)throw new V(`out of js stack`);b[--v]=a;return v});var c=(a=>b[a]);let a;const b=new M(N).fill(O);b.push(O,P,!0,!1);let d=b.length;let h=R;let i=P;const k=typeof TextEncoder!==T?new TextEncoder(U):{encode:()=>{throw V(`TextEncoder not available`)}};const l=typeof k.encodeInto===W?((a,b)=>k.encodeInto(a,b)):((a,b)=>{const c=k.encode(a);b.set(c);return {read:a.length,written:c.length}});let o=P;const q=typeof TextDecoder!==T?new TextDecoder(U,{ignoreBOM:!0,fatal:!0}):{decode:()=>{throw V(`TextDecoder not available`)}};if(typeof TextDecoder!==T){q.decode()};let v=N;let D=P;export default L;export{K as initSync}