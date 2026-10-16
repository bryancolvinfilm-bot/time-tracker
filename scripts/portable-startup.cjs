const { readFileSync } = require('node:fs');
const path = require('node:path');

// electron-builder 26.15.3 has no portable include hook. Adapt its pinned template
// in memory so its normal arch handling, compression, signing, and artifacts stay intact.
module.exports = async function configurePortableStartup() {
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
  const prototype = NsisTarget.prototype;
  const installed = Symbol.for('time-tracker.portable-startup');
  if (prototype[installed]) return true;
  prototype[installed] = true;
  const original = prototype.computeFinalScript;
  prototype.computeFinalScript = async function (raw, ...args) {
    const script = await original.call(this, raw, ...args);
    if (!this.isPortable) return script;
    let result = script.replace(/\r\n/g, '\n');
    const replace = (before, after) => {
      if (!result.includes(before)) throw new Error('Portable launcher template changed; review the startup adapter before building.');
      result = result.replace(before, after);
    };
    const controls = readFileSync(path.join(__dirname, '../build/portable-startup.nsh'), 'utf8');
    replace('Function .onInit\n', `${controls}\nFunction .onInit\n`);
    replace('  !ifndef SPLASH_IMAGE\n    SetSilent silent\n  !endif', '  SetSilent normal');
    const gui = /Function \.onGUIInit\n[\s\S]*?FunctionEnd/;
    if (!gui.test(result)) throw new Error('Portable launcher GUI hook was not found.');
    result = result.replace(gui, 'Function .onGUIInit\n  InitPluginsDir\nFunctionEnd');
    replace('  !ifdef SPLASH_IMAGE\n    HideWindow\n  !endif', '  SetDetailsPrint none\n  Call StartupBegin');
    // Each launch owns its extraction directory; a second click must not remove
    // files that an existing portable instance is using.
    replace('  !ifdef UNPACK_DIR_NAME\n    StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"\n  !endif', '  ; Keep the unique $PLUGINSDIR extraction directory.');
    replace('\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0\n  SetErrorLevel $0', '  StrCpy $StartupArguments $R0\n  Call PortableLaunch\n  SetErrorLevel $StartupExitCode');
    return result;
  };
  return true;
};
