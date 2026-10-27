(function(root){
  "use strict";
  // Preview initialization can authenticate and read a snapshot, but never mutate it.
  const allowed=new Set(["ensureAnonymousUser","isHost","loginHost","getBoard"]);
  function connection(client){
    return new Proxy(client,{get(target,key){
      if(typeof target[key]!=="function")return undefined;
      return allowed.has(key)?target[key].bind(target):async()=>{throw new Error("This action is unavailable in admin preview. Return to the live board first.")};
    }});
  }
  const api={connection};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else root.CastAdminPreview=api;
})(typeof window!=="undefined"?window:globalThis);
