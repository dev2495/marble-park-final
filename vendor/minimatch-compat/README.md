# Minimatch compatibility adapter

ExcelJS 4.4 still reaches legacy CommonJS consumers that call `minimatch` as a
function. Patched minimatch releases expose an object instead. This adapter
preserves the callable CommonJS contract while delegating all matching to the
patched `minimatch@10.2.6` implementation.
