(function() {
  if (typeof parts === 'undefined') return;
  
  const cache = {}, orig = {}, origMethods = {}, saved = new Set(), applied = new Set();
  const PATCHED = ['Devylocal (vaakx)', 'Quasar (vaakx)'];
  let pending;

  function apply(data, restore) {
    if (!data) return;
    for (let key in data) {
      const [t, p] = key.split('.');
      if (!parts[t]?.prototype) continue;
      if (!restore && !saved.has(key)) {
        orig[key] = parts[t].prototype[p];
        saved.add(key);
      }
      parts[t].prototype[p] = restore ? orig[key] : data[key];
    }
  }

  function applyPatches(patches) {
    if (!Array.isArray(patches)) return;
    let count = 0;
    patches.forEach(patch => {
      const id = `${patch.target||'*'}.${patch.method}.${patch.find||'*'}`;
      if (applied.has(id)) return;
      
      for (let name in parts) {
        const cls = parts[name];
        if (!cls?.prototype || (patch.target && name !== patch.target) ||
            (patch.find && !cls.prototype[patch.find]) || cls[`_p_${patch.method}`]) continue;
        
        const fn = cls.prototype[patch.method];
        if (typeof fn !== 'function') continue;

        try {
          const methodKey = `${name}.${patch.method}`;
          if (!origMethods[methodKey]) {
            origMethods[methodKey] = fn;
          }
          
          cls.prototype[patch.method] = new Function('o', `return function(){o?.apply(this,arguments);${patch.code}}`)(fn);
          cls[`_p_${patch.method}`] = 1;
          applied.add(id);
          count++;
          if (patch.target) break;
        } catch(e) {}
      }
    });
    return count;
  }

  function clear() {
    const propCount = saved.size;
    const methodCount = Object.keys(origMethods).length;
    
    apply(orig, 1);
    
    // Restore original methods
    for (let key in origMethods) {
      const [name, method] = key.split('.');
      if (parts[name]?.prototype) {
        parts[name].prototype[method] = origMethods[key];
        delete parts[name][`_p_${method}`];
      }
    }
    
    applied.clear();
    
    if (propCount > 0 || methodCount > 0) {
      console.log(`[Patch] Unloaded: ${propCount} properties, ${methodCount} methods`);
    }
  }

  const origProc = Interpolator.prototype.process;
  Interpolator.prototype.process = function(data) {
    const cmd = Array.isArray(data) ? data[0] : null;
    const srv = battleMode?.serverName;
    
    if (cmd === 'changes' || data?.changes) {
      const payload = cmd === 'changes' ? data[1] : data.changes;
      const changes = payload?.changes || payload;
      const propCount = Object.keys(changes || {}).length;
      const patchCount = applyPatches(payload?.patches);
      
      if (propCount > 0 || patchCount > 0) {
        console.log(`[Patch] Loaded: ${propCount} properties, ${patchCount} methods${srv ? ` (${srv})` : ''}`);
      }
      
      apply(changes);
      if (srv) {
        cache[srv] = payload;
        if (pending) clearTimeout(pending.t), clearInterval(pending.i), pending = null;
      }
    } else if (cmd === 'change' && data[1]) {
      apply({[data[1]]: data[2]});
      if (srv) ((cache[srv] = cache[srv] || {}).changes = cache[srv].changes || {})[data[1]] = data[2];
    } else if (cmd === 'reset') {
      clear();
      if (srv) delete cache[srv];
    }
    
    origProc.apply(this, arguments);
  };

  const origJoin = BattleMode.prototype.joinServer;
  BattleMode.prototype.joinServer = function(srv) {
    origJoin.apply(this, arguments);
    if (pending) clearTimeout(pending.t), clearInterval(pending.i), pending = null;
    
    if (PATCHED.includes(srv)) {
      if (cache[srv]) {
        const c = cache[srv].changes || cache[srv];
        const propCount = Object.keys(c || {}).length;
        const patchCount = applyPatches(cache[srv].patches);
        apply(c);
        console.log(`[Patch] Loaded from cache: ${propCount} properties, ${patchCount} methods (${srv})`);
      } else if (!intp.local) request(srv);
    } else {
      clear();
    }
  };

  function request(srv) {
    let n = 0;
    const check = () => {
      if (network.websocket?.readyState === 1) {
        network.send('requestChanges');
        let t = 0;
        const i = setInterval(() => {
          if (cache[srv]) {
            const c = cache[srv].changes || cache[srv];
            const propCount = Object.keys(c || {}).length;
            const patchCount = applyPatches(cache[srv].patches);
            apply(c);
            console.log(`[Patch] Loaded: ${propCount} properties, ${patchCount} methods (${srv})`);
            clearInterval(i);
            pending = null;
          } else if ((t += 100) >= 5000) clearInterval(i), pending = null;
        }, 100);
        pending = {i};
      } else if (++n < 50) pending = {t: setTimeout(check, 100)};
    };
    check();
  }

  // Only send initial request if already on a patched server
  if (!intp.local && PATCHED.includes(battleMode?.serverName) && 
      network.websocket?.readyState === 1) {
    network.send('requestChanges');
  }
})();
