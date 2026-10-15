(function(){
  if (location.protocol === "file:") return;
  var id;
  try {
    id = sessionStorage.getItem("fz_vid");
    if (!id) {
      id = "v" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("fz_vid", id);
    }
  } catch (e) { id = "v" + Math.random().toString(36).slice(2); }
  var page = location.pathname.replace(/^\//, "") || "index.html";
  function ping(){
    if (document.hidden) return;
    try { fetch("/api/ping", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:id,page:page}), keepalive:true }); } catch (e) {}
  }
  ping();
  setInterval(ping, 3000);
  document.addEventListener("visibilitychange", function(){ if (!document.hidden) ping(); });
  window.addEventListener("pagehide", function(){
    try { navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({id:id})], {type:"application/json"})); } catch (e) {}
  });
})();
