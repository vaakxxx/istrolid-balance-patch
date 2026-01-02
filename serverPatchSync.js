(function() {
  const cache = {}, originals = {}, saved = new Set();
  const PATCHED = ['Devylocal (vaakx)', 'Quasar (vaakx)'];
  const appliedPatches = new Set();

  function apply(data, restore) {
    if (!data) return;
    
    for (let key in data) {
      const [type, prop] = key.split('.');
      
      if (!parts[type]) {
        console.warn(`[Patch] Unknown part type: ${type} (skipping ${key})`);
        continue;
      }
      
      if (!parts[type].prototype) {
        console.warn(`[Patch] Part ${type} has no prototype (skipping ${key})`);
        continue;
      }
      
      if (!restore && !saved.has(key)) {
        originals[key] = parts[type].prototype[prop];
        saved.add(key);
      }
      
      parts[type].prototype[prop] = data[key];
    }
  }

  function applyPatches(patches) {
    if (!patches || !Array.isArray(patches)) return;
    
    patches.forEach(patch => {
      const patchId = `${patch.target || 'any'}.${patch.method}.${patch.find || 'any'}`;
      if (appliedPatches.has(patchId)) return;

      for (let name in parts) {
        const cls = parts[name];
        
        if (!cls?.prototype) continue;
        if (patch.target && name !== patch.target) continue;
        if (patch.find && !cls.prototype[patch.find]) continue;
        if (cls[`_patched_${patch.method}`]) continue;
        
        const orig = cls.prototype[patch.method];
        if (!orig) continue;

        try {
          const patchFn = new Function('original', `return function() {
            original?.apply(this, arguments);
            ${patch.code}
          }`)(orig);
          
          cls.prototype[patch.method] = patchFn;
          cls[`_patched_${patch.method}`] = true;
          appliedPatches.add(patchId);
          
          if (patch.target) break;
        } catch (err) {
          console.error(`[Patch] Failed to apply patch to ${name}.${patch.method}:`, err);
        }
      }
    });
  }

  const origProcess = Interpolator.prototype.process;
  Interpolator.prototype.process = function(data) {
    if (!data) {
      origProcess.apply(this, arguments);
      return;
    }
    
    const cmd = Array.isArray(data) ? data[0] : null;
    const arg1 = Array.isArray(data) ? data[1] : null;
    const arg2 = Array.isArray(data) ? data[2] : null;
    const server = battleMode?.serverName;
    
    if (cmd === 'changes' || data.changes) {
      const payload = cmd === 'changes' ? arg1 : data.changes;
      const changes = payload?.changes || payload;
      const patches = payload?.patches;
      
      apply(changes);
      applyPatches(patches);
      if (server) cache[server] = payload;
    } else if (cmd === 'change' && arg1) {
      apply({[arg1]: arg2});
      if (server) {
        if (!cache[server]) cache[server] = {};
        if (!cache[server].changes) cache[server].changes = {};
        cache[server].changes[arg1] = arg2;
      }
    } else if (cmd === 'reset') {
      apply(originals, true);
      appliedPatches.clear();
      if (server) cache[server] = {};
    }
    
    origProcess.apply(this, arguments);
  };

  const origJoin = BattleMode.prototype.joinServer;
  BattleMode.prototype.joinServer = function(server) {
    origJoin.apply(this, arguments);
    
    if (PATCHED.includes(server)) {
      if (cache[server]) {
        const changes = cache[server].changes || cache[server];
        const patches = cache[server].patches;
        apply(changes);
        applyPatches(patches);
      } else if (!intp.local) {
        requestChanges(server);
      }
    } else {
      apply(originals, true);
      appliedPatches.clear();
    }
  };

  function requestChanges(server) {
    let attempts = 0;
    const check = () => {
      if (network.websocket?.readyState === 1) {
        network.send('requestChanges');
        const poll = setInterval(() => {
          if (cache[server]) {
            const changes = cache[server].changes || cache[server];
            const patches = cache[server].patches;
            apply(changes);
            applyPatches(patches);
            clearInterval(poll);
          }
        }, 100);
      } else if (++attempts < 100) {
        setTimeout(check, 100);
      }
    };
    check();
  }

  !intp.local && network.send('requestChanges');
})();
