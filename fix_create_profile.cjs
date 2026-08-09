const fs = require('fs');
let code = fs.readFileSync('src/services/firebaseService.ts', 'utf8');

const before = `  } catch (error) {
    console.error('Error in createOrUpdateUserProfile:', error);
    throw error;
  }`;

const after = `  } catch (error: any) {
    console.warn('Error in createOrUpdateUserProfile (possibly offline):', error);
    if (error?.code !== 'unavailable' && error?.message?.indexOf('offline') === -1 && error?.message?.indexOf('network') === -1) {
       // Only throw if it's not a typical offline/network error, to prevent blocking login
       throw error;
    }
  }`;

code = code.replace(before, after);
fs.writeFileSync('src/services/firebaseService.ts', code);
