/* @ds-bundle: {"format":4,"namespace":"ClaudeDesignSystem_adb02b","components":[{"name":"Badge","sourcePath":"components/badges/Badge.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"CalloutCardCoral","sourcePath":"components/cards/CalloutCardCoral.jsx"},{"name":"CodeWindowCard","sourcePath":"components/cards/CodeWindowCard.jsx"},{"name":"ConnectorTile","sourcePath":"components/cards/ConnectorTile.jsx"},{"name":"CookieConsentCard","sourcePath":"components/cards/CookieConsentCard.jsx"},{"name":"FeatureCard","sourcePath":"components/cards/FeatureCard.jsx"},{"name":"HeroIllustrationCard","sourcePath":"components/cards/HeroIllustrationCard.jsx"},{"name":"ModelComparisonCard","sourcePath":"components/cards/ModelComparisonCard.jsx"},{"name":"PricingTierCard","sourcePath":"components/cards/PricingTierCard.jsx"},{"name":"ProductMockupCardDark","sourcePath":"components/cards/ProductMockupCardDark.jsx"},{"name":"TextInput","sourcePath":"components/inputs/TextInput.jsx"},{"name":"TopNav","sourcePath":"components/navigation/TopNav.jsx"},{"name":"CtaBand","sourcePath":"components/sections/CtaBand.jsx"},{"name":"Footer","sourcePath":"components/sections/Footer.jsx"},{"name":"HeroBand","sourcePath":"components/sections/HeroBand.jsx"},{"name":"CategoryTab","sourcePath":"components/tabs/CategoryTab.jsx"}],"sourceHashes":{"components/badges/Badge.jsx":"9ffa6c00054f","components/buttons/Button.jsx":"69066b0d6958","components/buttons/IconButton.jsx":"d839fe8d5da6","components/cards/CalloutCardCoral.jsx":"062aceb4a73b","components/cards/CodeWindowCard.jsx":"9ee7afb1d182","components/cards/ConnectorTile.jsx":"710706883ced","components/cards/CookieConsentCard.jsx":"11362810f136","components/cards/FeatureCard.jsx":"977850ec29a8","components/cards/HeroIllustrationCard.jsx":"d1415080bb42","components/cards/ModelComparisonCard.jsx":"ed7202c39f15","components/cards/PricingTierCard.jsx":"c85a7e032755","components/cards/ProductMockupCardDark.jsx":"f694348c522f","components/inputs/TextInput.jsx":"290383ea241d","components/navigation/TopNav.jsx":"f63ecb851e0c","components/sections/CtaBand.jsx":"3810a6c0c6d4","components/sections/Footer.jsx":"bde8a9e89f69","components/sections/HeroBand.jsx":"ad0364d22c29","components/tabs/CategoryTab.jsx":"3d6831b50e4f","ui_kits/marketing-site/MarketingSite.jsx":"609583148c8c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ClaudeDesignSystem_adb02b = window.ClaudeDesignSystem_adb02b || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/badges/Badge.jsx
try { (() => {
function Badge({
  children,
  variant = 'neutral'
}) {
  const variants = {
    neutral: {
      background: 'var(--color-surface-card)',
      color: 'var(--color-ink)',
      textTransform: 'none',
      letterSpacing: 0,
      fontSize: 13,
      fontWeight: 500
    },
    coral: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      fontSize: 12,
      fontWeight: 500
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      borderRadius: 'var(--radius-pill)',
      padding: '4px 12px',
      display: 'inline-block',
      ...variants[variant]
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/badges/Badge.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
function Button({
  variant = 'primary',
  children,
  onClick,
  disabled,
  style
}) {
  const base = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-button-size)',
    fontWeight: 500,
    borderRadius: 'var(--radius-md)',
    padding: '12px 20px',
    height: 40,
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background var(--duration-fast) var(--ease-standard)'
  };
  const variants = {
    primary: {
      background: disabled ? 'var(--color-primary-disabled)' : 'var(--color-primary)',
      color: disabled ? 'var(--color-muted)' : 'var(--color-on-primary)'
    },
    secondary: {
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)',
      border: '1px solid var(--color-hairline)'
    },
    'secondary-on-dark': {
      background: 'var(--color-surface-dark-elevated)',
      color: 'var(--color-on-dark)'
    },
    'text-link': {
      background: 'transparent',
      color: 'var(--color-ink)',
      padding: '4px 0',
      height: 'auto'
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    disabled: disabled,
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/buttons/IconButton.jsx
try { (() => {
function IconButton({
  children = '→',
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      width: 36,
      height: 36,
      borderRadius: 'var(--radius-full)',
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)',
      border: '1px solid var(--color-hairline)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      fontSize: 16,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/cards/CalloutCardCoral.jsx
try { (() => {
function CalloutCardCoral({
  title = 'Start building today',
  body = 'Get API access and start shipping in minutes.'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      borderRadius: 'var(--radius-lg)',
      padding: 32,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      fontWeight: 500,
      marginBottom: 4
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      opacity: 0.9
    }
  }, body)), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)',
      border: 'none',
      borderRadius: 8,
      padding: '12px 20px',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, "Get started"));
}
Object.assign(__ds_scope, { CalloutCardCoral });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/CalloutCardCoral.jsx", error: String((e && e.message) || e) }); }

// components/cards/CodeWindowCard.jsx
try { (() => {
function CodeWindowCard({
  filename = 'main.py',
  lines = ['from anthropic import Anthropic', '', 'client = Anthropic()', 'msg = client.messages.create(', '    model="claude-opus-4",', '    max_tokens=1024,', '    messages=[{"role":"user","content":"Hello"}]', ')']
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark)',
      color: 'var(--color-on-dark)',
      borderRadius: 'var(--radius-lg)',
      padding: 0,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      padding: '12px 16px',
      borderBottom: '1px solid var(--color-surface-dark-elevated)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: 'var(--color-muted-soft)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--color-on-dark-soft)',
      marginLeft: 8
    }
  }, filename)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark-soft)',
      padding: 24,
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 14,
      lineHeight: 1.6,
      color: 'var(--color-on-dark)'
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-on-dark-soft)',
      width: 20,
      textAlign: 'right'
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", null, l))))));
}
Object.assign(__ds_scope, { CodeWindowCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/CodeWindowCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/ConnectorTile.jsx
try { (() => {
function ConnectorTile({
  name = 'GitHub',
  description = 'Connect repositories',
  icon = '◆'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-canvas)',
      border: '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 16,
      fontWeight: 500
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--color-muted)'
    }
  }, description));
}
Object.assign(__ds_scope, { ConnectorTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ConnectorTile.jsx", error: String((e && e.message) || e) }); }

// components/cards/CookieConsentCard.jsx
try { (() => {
function CookieConsentCard({
  onAccept,
  onDismiss
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark)',
      color: 'var(--color-on-dark)',
      borderRadius: 'var(--radius-lg)',
      padding: 24,
      maxWidth: 360,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      fontWeight: 500
    }
  }, "We use cookies"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--color-on-dark-soft)',
      lineHeight: 1.55
    }
  }, "We use cookies to improve your experience. See our cookie policy for details."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onAccept,
    style: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: 'none',
      borderRadius: 8,
      padding: '8px 16px',
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Accept"), /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    style: {
      background: 'var(--color-surface-dark-elevated)',
      color: 'var(--color-on-dark)',
      border: 'none',
      borderRadius: 8,
      padding: '8px 16px',
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Dismiss")));
}
Object.assign(__ds_scope, { CookieConsentCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/CookieConsentCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/FeatureCard.jsx
try { (() => {
function FeatureCard({
  title = 'Build with Claude',
  body = 'Ship AI-native products with the Claude API and Agent SDK.',
  icon = '✳'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-card)',
      color: 'var(--color-ink)',
      borderRadius: 'var(--radius-lg)',
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      marginBottom: 16
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      fontWeight: 500,
      marginBottom: 8
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      lineHeight: 1.55,
      color: 'var(--color-body)'
    }
  }, body));
}
Object.assign(__ds_scope, { FeatureCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/FeatureCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/HeroIllustrationCard.jsx
try { (() => {
function HeroIllustrationCard({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-canvas)',
      border: '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-xl)',
      minHeight: 280,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--color-muted)'
    }
  }, children || 'Line-art / product illustration');
}
Object.assign(__ds_scope, { HeroIllustrationCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/HeroIllustrationCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/ModelComparisonCard.jsx
try { (() => {
function ModelComparisonCard({
  name = 'Claude Opus',
  description = 'Our most capable model for complex reasoning.'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-canvas)',
      border: '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-lg)',
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      fontWeight: 500,
      marginBottom: 8
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      color: 'var(--color-body)',
      marginBottom: 16
    }
  }, description), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 14,
      color: 'var(--color-primary)',
      fontWeight: 500
    }
  }, "Learn more \u2192"));
}
Object.assign(__ds_scope, { ModelComparisonCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ModelComparisonCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/PricingTierCard.jsx
try { (() => {
function PricingTierCard({
  tier = 'Pro',
  price = '$20',
  period = '/mo',
  features = ['5x more usage', 'Priority access', 'Early access to features'],
  featured = false
}) {
  const dark = featured;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: dark ? 'var(--color-surface-dark)' : 'var(--color-canvas)',
      color: dark ? 'var(--color-on-dark)' : 'var(--color-ink)',
      border: dark ? 'none' : '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-lg)',
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 22,
      fontWeight: 500,
      marginBottom: 12
    }
  }, tier), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif-display)',
      fontSize: 36,
      marginBottom: 16
    }
  }, price, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontFamily: 'var(--font-sans)',
      color: dark ? 'var(--color-on-dark-soft)' : 'var(--color-muted)'
    }
  }, period)), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: '0 0 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, features.map(f => /*#__PURE__*/React.createElement("li", {
    key: f,
    style: {
      fontSize: 14,
      color: dark ? 'var(--color-on-dark-soft)' : 'var(--color-body)'
    }
  }, "\u2022 ", f))), /*#__PURE__*/React.createElement("button", {
    style: {
      width: '100%',
      background: dark ? 'var(--color-primary)' : 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: 'none',
      borderRadius: 8,
      padding: '10px 0',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Choose ", tier));
}
Object.assign(__ds_scope, { PricingTierCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/PricingTierCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/ProductMockupCardDark.jsx
try { (() => {
function ProductMockupCardDark({
  title = 'Claude Code',
  body = 'Delegate real engineering tasks from the terminal.'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark)',
      color: 'var(--color-on-dark)',
      borderRadius: 'var(--radius-lg)',
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      fontWeight: 500,
      marginBottom: 8
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      lineHeight: 1.55,
      color: 'var(--color-on-dark-soft)',
      marginBottom: 20
    }
  }, body), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark-elevated)',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--color-accent-teal)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--color-on-dark-soft)'
    }
  }, "Connected to workspace")));
}
Object.assign(__ds_scope, { ProductMockupCardDark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ProductMockupCardDark.jsx", error: String((e && e.message) || e) }); }

// components/inputs/TextInput.jsx
try { (() => {
const {
  useState
} = React;
function TextInput({
  placeholder = 'you@company.com',
  value,
  onChange,
  style
}) {
  const [focused, setFocused] = useState(false);
  return /*#__PURE__*/React.createElement("input", {
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 16,
      color: 'var(--color-ink)',
      background: 'var(--color-canvas)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      height: 40,
      boxSizing: 'border-box',
      border: focused ? '1.5px solid var(--color-primary)' : '1px solid var(--color-hairline)',
      boxShadow: focused ? '0 0 0 3px rgba(204,120,92,0.15)' : 'none',
      outline: 'none',
      width: '100%',
      ...style
    }
  });
}
Object.assign(__ds_scope, { TextInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/inputs/TextInput.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TopNav.jsx
try { (() => {
function TopNav({
  links = ['Claude', 'API', 'Solutions', 'Research', 'Pricing']
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 32px',
      background: 'var(--color-canvas)',
      borderBottom: '1px solid var(--color-hairline)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      fontSize: 16,
      color: 'var(--color-ink)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      fontSize: 18
    }
  }, "\u2733"), " Claude"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28
    }
  }, links.slice(1).map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--color-ink)'
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--color-ink)'
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: 'none',
      borderRadius: 8,
      padding: '10px 18px',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Try Claude")));
}
Object.assign(__ds_scope, { TopNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TopNav.jsx", error: String((e && e.message) || e) }); }

// components/sections/CtaBand.jsx
try { (() => {
function CtaBand({
  variant = 'coral',
  title = 'Try Claude',
  subtitle
}) {
  const dark = variant === 'dark';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: dark ? 'var(--color-surface-dark)' : 'var(--color-primary)',
      color: dark ? 'var(--color-on-dark)' : 'var(--color-on-primary)',
      borderRadius: 'var(--radius-lg)',
      padding: 64,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif-display)',
      fontSize: 28,
      letterSpacing: '-0.3px',
      marginBottom: subtitle ? 12 : 24
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 16,
      opacity: 0.85,
      marginBottom: 24
    }
  }, subtitle), /*#__PURE__*/React.createElement("button", {
    style: {
      background: dark ? 'var(--color-primary)' : 'var(--color-canvas)',
      color: dark ? 'var(--color-on-primary)' : 'var(--color-ink)',
      border: 'none',
      borderRadius: 8,
      padding: '12px 24px',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Get started"));
}
Object.assign(__ds_scope, { CtaBand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/sections/CtaBand.jsx", error: String((e && e.message) || e) }); }

// components/sections/Footer.jsx
try { (() => {
function Footer({
  columns = [{
    title: 'Product',
    links: ['Claude', 'API', 'Pricing']
  }, {
    title: 'Research',
    links: ['Overview', 'Publications']
  }, {
    title: 'Company',
    links: ['About', 'Careers']
  }, {
    title: 'Legal',
    links: ['Privacy', 'Terms']
  }]
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-dark)',
      color: 'var(--color-on-dark-soft)',
      padding: 64
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      color: 'var(--color-on-dark)',
      fontWeight: 600,
      marginBottom: 40
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u2733"), " Elkit"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 32
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.title
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--color-on-dark)',
      fontSize: 14,
      fontWeight: 500,
      marginBottom: 12
    }
  }, c.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, c.links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 14,
      color: 'var(--color-on-dark-soft)'
    }
  }, l)))))));
}
Object.assign(__ds_scope, { Footer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/sections/Footer.jsx", error: String((e && e.message) || e) }); }

// components/sections/HeroBand.jsx
try { (() => {
function HeroBand({
  title = 'Meet your thinking partner',
  subtitle = 'Claude is a family of AI models built by Anthropic to help you think, write, and build.',
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)',
      padding: 96,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 48,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-serif-display)',
      fontWeight: 400,
      fontSize: 64,
      lineHeight: 1.05,
      letterSpacing: '-1.5px',
      margin: '0 0 20px'
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      color: 'var(--color-body)',
      lineHeight: 1.55,
      margin: '0 0 28px'
    }
  }, subtitle), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: 'none',
      borderRadius: 8,
      padding: '12px 20px',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Try Claude"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'var(--color-canvas)',
      color: 'var(--color-ink)',
      border: '1px solid var(--color-hairline)',
      borderRadius: 8,
      padding: '12px 20px',
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Contact sales"))), children);
}
Object.assign(__ds_scope, { HeroBand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/sections/HeroBand.jsx", error: String((e && e.message) || e) }); }

// components/tabs/CategoryTab.jsx
try { (() => {
function CategoryTab({
  children,
  active,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: 500,
      padding: '8px 14px',
      borderRadius: 'var(--radius-md)',
      border: 'none',
      cursor: 'pointer',
      background: active ? 'var(--color-surface-card)' : 'transparent',
      color: active ? 'var(--color-ink)' : 'var(--color-muted)'
    }
  }, children);
}
Object.assign(__ds_scope, { CategoryTab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tabs/CategoryTab.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing-site/MarketingSite.jsx
try { (() => {
const {
  TopNav,
  Button,
  IconButton,
  TextInput,
  CategoryTab,
  Badge,
  FeatureCard,
  ProductMockupCardDark,
  CodeWindowCard,
  ModelComparisonCard,
  PricingTierCard,
  CalloutCardCoral,
  ConnectorTile,
  CookieConsentCard,
  HeroBand,
  HeroIllustrationCard,
  CtaBand,
  Footer
} = window.ClaudeDesignSystem_adb02b;
function useToggle(init) {
  const [v, setV] = React.useState(init);
  return [v, () => setV(!v)];
}
function CookieBanner() {
  const [visible, setVisible] = React.useState(true);
  if (!visible) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement(CookieConsentCard, {
    onAccept: () => setVisible(false),
    onDismiss: () => setVisible(false)
  }));
}
function PricingSection() {
  const [tab, setTab] = React.useState('Business');
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-display-md",
    style: {
      marginBottom: 24
    }
  }, "Choose your plan"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: 8,
      background: 'var(--color-surface-soft)',
      padding: 4,
      borderRadius: 10
    }
  }, ['Individual', 'Business'].map(t => /*#__PURE__*/React.createElement(CategoryTab, {
    key: t,
    active: tab === t,
    onClick: () => setTab(t)
  }, t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(PricingTierCard, {
    tier: "Free",
    price: "$0",
    features: ['Chat on web, iOS, and Android', 'Generate code and visualize data']
  }), /*#__PURE__*/React.createElement(PricingTierCard, {
    tier: "Pro",
    price: "$20",
    features: ['5x more usage than Free', 'Access to Projects', 'Extended thinking']
  }), /*#__PURE__*/React.createElement(PricingTierCard, {
    tier: "Team",
    price: "$25",
    featured: true,
    features: ['Central billing', 'Higher usage', 'Priority support']
  })));
}
function ContactForm() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 420,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(TextInput, {
    placeholder: "you@company.com",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => setSent(true),
    style: {
      width: '100%'
    }
  }, sent ? 'Thanks — we\u2019ll be in touch' : 'Contact sales'));
}
function MarketingSite() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-canvas)'
    }
  }, /*#__PURE__*/React.createElement(TopNav, null), /*#__PURE__*/React.createElement(HeroBand, null, /*#__PURE__*/React.createElement(HeroIllustrationCard, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24
    }
  }, /*#__PURE__*/React.createElement(CodeWindowCard, {
    filename: "agent.py",
    lines: ['from anthropic import Anthropic', '', 'client = Anthropic()', 'response = client.messages.create(', '    model="claude-opus-4-5",', '    messages=[{"role": "user", "content": "hi"}]', ')']
  })))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-display-sm",
    style: {
      marginBottom: 32
    }
  }, "Build with Claude"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(FeatureCard, {
    title: "Claude API",
    body: "Integrate Claude into your product with a few lines of code.",
    icon: "\u2733"
  }), /*#__PURE__*/React.createElement(FeatureCard, {
    title: "Agent SDK",
    body: "Build autonomous agents that plan, use tools, and act.",
    icon: "\u2733"
  }), /*#__PURE__*/React.createElement(FeatureCard, {
    title: "Claude Code",
    body: "Delegate real engineering work from your terminal.",
    icon: "\u2733"
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(ProductMockupCardDark, {
    title: "Claude Code",
    body: "Delegate real engineering tasks from the terminal."
  }), /*#__PURE__*/React.createElement(ProductMockupCardDark, {
    title: "Claude in Chrome",
    body: "Let Claude navigate and act on your behalf in the browser."
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-display-sm",
    style: {
      marginBottom: 32
    }
  }, "Models"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(ModelComparisonCard, {
    name: "Claude Opus",
    description: "Our most capable model for complex reasoning."
  }), /*#__PURE__*/React.createElement(ModelComparisonCard, {
    name: "Claude Sonnet",
    description: "Balanced intelligence and speed for everyday work."
  }), /*#__PURE__*/React.createElement(ModelComparisonCard, {
    name: "Claude Haiku",
    description: "Fast, low-cost responses for high-volume tasks."
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-display-sm",
    style: {
      marginBottom: 32
    }
  }, "Connect your tools"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(ConnectorTile, {
    name: "GitHub",
    description: "Connect repositories",
    icon: "\u25C6"
  }), /*#__PURE__*/React.createElement(ConnectorTile, {
    name: "Slack",
    description: "Bring Claude into Slack",
    icon: "\u25C6"
  }), /*#__PURE__*/React.createElement(ConnectorTile, {
    name: "Google Drive",
    description: "Search your docs",
    icon: "\u25C6"
  }), /*#__PURE__*/React.createElement(ConnectorTile, {
    name: "Notion",
    description: "Work with your workspace",
    icon: "\u25C6"
  }))), /*#__PURE__*/React.createElement(PricingSection, null), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement(CalloutCardCoral, {
    title: "Start building today",
    body: "Get API access and start shipping in minutes."
  })), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 96px 96px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-display-sm",
    style: {
      marginBottom: 16
    }
  }, "Talk to sales"), /*#__PURE__*/React.createElement(ContactForm, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 96px 96px'
    }
  }, /*#__PURE__*/React.createElement(CtaBand, {
    variant: "dark",
    title: "Start building",
    subtitle: "Claude is available via API, and on web, iOS, and Android."
  })), /*#__PURE__*/React.createElement(Footer, null), /*#__PURE__*/React.createElement(CookieBanner, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(MarketingSite, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing-site/MarketingSite.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.CalloutCardCoral = __ds_scope.CalloutCardCoral;

__ds_ns.CodeWindowCard = __ds_scope.CodeWindowCard;

__ds_ns.ConnectorTile = __ds_scope.ConnectorTile;

__ds_ns.CookieConsentCard = __ds_scope.CookieConsentCard;

__ds_ns.FeatureCard = __ds_scope.FeatureCard;

__ds_ns.HeroIllustrationCard = __ds_scope.HeroIllustrationCard;

__ds_ns.ModelComparisonCard = __ds_scope.ModelComparisonCard;

__ds_ns.PricingTierCard = __ds_scope.PricingTierCard;

__ds_ns.ProductMockupCardDark = __ds_scope.ProductMockupCardDark;

__ds_ns.TextInput = __ds_scope.TextInput;

__ds_ns.TopNav = __ds_scope.TopNav;

__ds_ns.CtaBand = __ds_scope.CtaBand;

__ds_ns.Footer = __ds_scope.Footer;

__ds_ns.HeroBand = __ds_scope.HeroBand;

__ds_ns.CategoryTab = __ds_scope.CategoryTab;

})();
