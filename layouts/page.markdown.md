{{- /* Raw markdown mirror of each post, for agents and LLM readers. */ -}}
# {{ .Title }}

> {{ with .Description }}{{ . }}{{ else }}{{ .Summary | plainify }}{{ end }}

- Source: {{ .Permalink }}
- Author: {{ site.Params.author }}
- Published: {{ .Date.Format "2006-01-02" }}
{{- if and (not .Lastmod.IsZero) (gt (.Lastmod.Sub .Date).Hours 24) }}
- Updated: {{ .Lastmod.Format "2006-01-02" }}
{{- end }}
{{- with .Params.tags }}
- Tags: {{ delimit . ", " }}
{{- end }}
- Words: {{ .WordCount }} ({{ .ReadingTime }} min read)
- License: CC BY 4.0 — cite as "{{ site.Params.author }}, {{ .Title }}, {{ .Permalink }}"

---

{{ .RawContent }}
