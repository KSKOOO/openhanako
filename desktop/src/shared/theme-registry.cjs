/**
 * theme-registry.cjs — 主题元信息唯一信源
 *
 * CJS 格式以便 main.cjs / preload.cjs 直接 require，Vite 也能 import。
 * 任何硬编码主题 id 字符串的 .ts/.tsx/.js/.cjs 都会被
 * tests/theme-registry-structural.test.js 挡住。
 */

const STORAGE_KEY = 'hana-theme';
const DEFAULT_THEME = 'warm-paper';
const AUTO_LIGHT_DEFAULT = 'warm-paper';
const AUTO_DARK_DEFAULT = 'midnight';
const LEGACY_THEME_ALIASES = Object.freeze({
  'claude-design': 'new-warm-paper',
});

const AUTO_OPTION = Object.freeze({
  id: 'auto',
  i18nName: 'settings.appearance.auto',
  i18nMode: 'settings.appearance.autoMode',
});

const THEMES = Object.freeze(Object.fromEntries(
  Object.entries({
    'warm-paper': {
      cssPath: 'themes/warm-paper.css',
      backgroundColor: '#F8F5ED',
      i18nName: 'settings.appearance.warmPaper',
      i18nMode: 'settings.appearance.warmPaperMode',
    },
    'midnight': {
      cssPath: 'themes/midnight.css',
      backgroundColor: '#3B4A54',
      i18nName: 'settings.appearance.midnight',
      i18nMode: 'settings.appearance.midnightMode',
    },
    'high-contrast': {
      cssPath: 'themes/high-contrast.css',
      backgroundColor: '#FAF9F6',
      i18nName: 'settings.appearance.highContrast',
      i18nMode: 'settings.appearance.highContrastMode',
    },
    'grass-aroma': {
      cssPath: 'themes/grass-aroma.css',
      backgroundColor: '#F5F8F3',
      i18nName: 'settings.appearance.grassAroma',
      i18nMode: 'settings.appearance.grassAromaMode',
    },
    'contemplation': {
      cssPath: 'themes/contemplation.css',
      backgroundColor: '#F3F5F7',
      i18nName: 'settings.appearance.contemplation',
      i18nMode: 'settings.appearance.contemplationMode',
    },
    'absolutely': {
      cssPath: 'themes/absolutely.css',
      backgroundColor: '#F4F3EE',
      i18nName: 'settings.appearance.absolutely',
      i18nMode: 'settings.appearance.absolutelyMode',
    },
    'delve': {
      cssPath: 'themes/delve.css',
      backgroundColor: '#FFFFFF',
      i18nName: 'settings.appearance.delve',
      i18nMode: 'settings.appearance.delveMode',
    },
    'deep-think': {
      cssPath: 'themes/deep-think.css',
      backgroundColor: '#FCFCFD',
      i18nName: 'settings.appearance.deepThink',
      i18nMode: 'settings.appearance.deepThinkMode',
    },
    'new-warm-paper': {
      cssPath: 'themes/new-warm-paper.css',
      backgroundColor: '#F5EFE4',
      i18nName: 'settings.appearance.newWarmPaper',
      i18nMode: 'settings.appearance.newWarmPaperMode',
    },
    'midnight-contrast': {
      cssPath: 'themes/midnight-contrast.css',
      backgroundColor: '#26343D',
      i18nName: 'settings.appearance.midnightContrast',
      i18nMode: 'settings.appearance.midnightContrastMode',
    },
  }).map(([k, v]) => [k, Object.freeze(v)])
));

// Spec-required startup assertion: every theme entry must have all 4 fields.
// Fails at module-load time (not at consumer call time) so misconfigurations
// surface clearly in every process that requires the registry.
// (All existing tests indirectly verify this by successfully loading the module.)
for (const [id, entry] of Object.entries(THEMES)) {
  if (!entry.cssPath || !entry.backgroundColor || !entry.i18nName || !entry.i18nMode) {
    throw new Error(`theme-registry: theme "${id}" is missing required fields (cssPath / backgroundColor / i18nName / i18nMode)`);
  }
  if (!/^#[0-9A-F]{6}$/i.test(entry.backgroundColor)) {
    throw new Error(`theme-registry: theme "${id}" has invalid backgroundColor "${entry.backgroundColor}" (must be 6-digit hex)`);
  }
}

/** 合法值原样返回（含 'auto'），非法 / null / undefined → DEFAULT_THEME。不主动覆写 localStorage。 */
function migrateSavedTheme(raw) {
  if (raw === 'auto') return 'auto';
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_THEME;
  if (LEGACY_THEME_ALIASES[raw]) return LEGACY_THEME_ALIASES[raw];
  return THEMES[raw] ? raw : DEFAULT_THEME;
}

/** 输入：localStorage 原始值 + 系统深色？
 *  输出：{ stored: 应保存回 localStorage 的值, concrete: 实际渲染主题 id } */
function resolveSavedTheme(raw, isDark) {
  const stored = migrateSavedTheme(raw);
  if (stored === 'auto') {
    return { stored, concrete: isDark ? AUTO_DARK_DEFAULT : AUTO_LIGHT_DEFAULT };
  }
  return { stored, concrete: stored };
}

function getThemeIds() {
  return Object.keys(THEMES);
}

function getAllUIOptions() {
  const themeOpts = getThemeIds().map((id) => ({
    id,
    i18nName: THEMES[id].i18nName,
    i18nMode: THEMES[id].i18nMode,
  }));
  return [...themeOpts, { ...AUTO_OPTION }];
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_THEME,
  AUTO_LIGHT_DEFAULT,
  AUTO_DARK_DEFAULT,
  AUTO_OPTION,
  LEGACY_THEME_ALIASES,
  THEMES,
  migrateSavedTheme,
  resolveSavedTheme,
  getThemeIds,
  getAllUIOptions,
};
