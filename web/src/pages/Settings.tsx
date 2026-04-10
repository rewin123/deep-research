import { useEffect, useState } from 'react';

import { type AppSettings, getSettings, updateSettings } from '../api/client';

const FIELDS: {
  key: keyof AppSettings;
  label: string;
  type: 'text' | 'password' | 'number';
  placeholder: string;
  hint?: string;
}[] = [
  {
    key: 'openaiKey',
    label: 'OpenAI API Key',
    type: 'password',
    placeholder: 'sk-...',
    hint: 'Required for OpenAI models',
  },
  {
    key: 'openaiEndpoint',
    label: 'OpenAI Endpoint',
    type: 'text',
    placeholder: 'https://api.openai.com/v1',
    hint: 'Custom endpoint for local LLMs (e.g. Ollama)',
  },
  {
    key: 'customModel',
    label: 'Custom Model Name',
    type: 'text',
    placeholder: 'e.g. llama3.1',
    hint: 'Set this to use a custom model with the endpoint above',
  },
  {
    key: 'searxngUrl',
    label: 'SearXNG URL',
    type: 'text',
    placeholder: 'http://localhost:8080',
    hint: 'URL of your SearXNG instance',
  },
  {
    key: 'tavilyApiKey',
    label: 'Tavily API Key',
    type: 'password',
    placeholder: 'tvly-...',
    hint: 'Required only when using Tavily search provider',
  },
  {
    key: 'fireworksKey',
    label: 'Fireworks API Key',
    type: 'password',
    placeholder: '',
    hint: 'For DeepSeek R1 model via Fireworks',
  },
  {
    key: 'fastModel',
    label: 'Fast Model Name',
    type: 'text',
    placeholder: 'e.g. gpt-4.1-mini',
    hint: 'Cheaper model for extraction/summarization. Leave empty to use primary model for everything.',
  },
  {
    key: 'fastModelEndpoint',
    label: 'Fast Model Endpoint',
    type: 'text',
    placeholder: '',
    hint: 'Endpoint for the fast model. Leave empty to use the primary endpoint.',
  },
  {
    key: 'contextSize',
    label: 'Context Size',
    type: 'number',
    placeholder: '128000',
    hint: 'Max token context window',
  },
  {
    key: 'llmTimeout',
    label: 'LLM Timeout (ms)',
    type: 'number',
    placeholder: '180000',
    hint: 'Timeout for LLM API calls',
  },
  {
    key: 'tavilyConcurrency',
    label: 'Search Concurrency',
    type: 'number',
    placeholder: '2',
    hint: 'Max parallel search queries',
  },
  {
    key: 'maxQueries',
    label: 'Max Search Queries',
    type: 'number',
    placeholder: '0',
    hint: 'Total search query budget across all levels. 0 = auto-compute from breadth/depth.',
  },
  {
    key: 'maxTimeMs',
    label: 'Max Research Time (ms)',
    type: 'number',
    placeholder: '0',
    hint: 'Wall-clock time limit for research. 0 = unlimited.',
  },
];

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: keyof AppSettings, value: string | number) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setSaved(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      await updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading settings...</div>;
  if (!settings) return <div className="error-state">Failed to load settings</div>;

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="page-description">
        Configure your API keys and model settings. These are saved on the
        server and used for all research sessions.
      </p>

      <form className="settings-form" onSubmit={handleSave}>
        <div className="form-group">
          <label htmlFor="searchProvider">Search Provider</label>
          <select
            id="searchProvider"
            className="form-input"
            value={settings.searchProvider || 'searxng'}
            onChange={e =>
              handleChange('searchProvider', e.target.value)
            }
          >
            <option value="searxng">
              SearXNG (free, self-hosted)
            </option>
            <option value="tavily">Tavily (requires API key)</option>
          </select>
          <span className="hint">
            SearXNG is free and self-hosted (docker run -d -p 8080:8080 searxng/searxng:latest).
            Tavily provides higher quality results but requires an API key.
          </span>
        </div>

        {FIELDS.map(field => (
          <div key={field.key} className="form-group">
            <label htmlFor={field.key}>{field.label}</label>
            <div className="input-wrapper">
              <input
                id={field.key}
                type={
                  field.type === 'password' && !showKeys[field.key]
                    ? 'password'
                    : field.type === 'password'
                      ? 'text'
                      : field.type
                }
                className="form-input"
                value={
                  field.type === 'number'
                    ? (settings[field.key] as number) || ''
                    : (settings[field.key] as string) || ''
                }
                onChange={e =>
                  handleChange(
                    field.key,
                    field.type === 'number'
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
                placeholder={field.placeholder}
              />
              {field.type === 'password' && (
                <button
                  type="button"
                  className="btn-toggle-vis"
                  onClick={() =>
                    setShowKeys(prev => ({
                      ...prev,
                      [field.key]: !prev[field.key],
                    }))
                  }
                >
                  {showKeys[field.key] ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {field.hint && <span className="hint">{field.hint}</span>}
          </div>
        ))}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="save-success">Settings saved!</span>}
        </div>
      </form>
    </div>
  );
}
