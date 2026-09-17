"""Turn a clab fence into a progressively enhanced topology/YAML component.

Use inline YAML or `file="examples/fabric.clab.yml"` relative to docs_dir.
The source stays readable without JavaScript and is never interpolated into script.
"""

from html import escape
from pathlib import Path
import json
import re
import shlex

from markdown import Extension
from markdown.preprocessors import Preprocessor
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import YamlLexer
import yaml


class TopologyPreprocessor(Preprocessor):
    def __init__(self, md, docs_dir):
        super().__init__(md)
        self.docs_dir = Path(docs_dir).resolve()

    def read_asset(self, value):
        path = (self.docs_dir / value).resolve()
        if not path.is_relative_to(self.docs_dir):
            raise ValueError(f"Topology asset must be inside docs_dir: {value}")
        return path.read_text(encoding="utf-8")

    def component(self, options, body):
        allowed = {"title", "file", "annotations", "view", "height", "filename"}
        unknown = options.keys() - allowed
        if unknown:
            raise ValueError(f"Unknown clab fence options: {', '.join(sorted(unknown))}")
        source = self.read_asset(options["file"]) if "file" in options else body
        if "file" in options and body.strip():
            raise ValueError("A clab fence accepts a file or inline YAML, not both")
        data = yaml.safe_load(source)
        if not isinstance(data, dict) or not isinstance(data.get("topology"), dict):
            raise ValueError("A clab fence needs a containerlab topology mapping")
        if not isinstance(data["topology"].get("nodes"), dict) or not data["topology"]["nodes"]:
            raise ValueError("A clab fence needs at least one node")
        view = options.get("view", "topology")
        if view not in {"topology", "yaml", "split"}:
            raise ValueError(f"Unknown topology view: {view}")
        height = int(options.get("height", "460"))
        if not 240 <= height <= 1000:
            raise ValueError("Topology height must be between 240 and 1000 pixels")
        title = options.get("title", str(data.get("name", "Network topology")))
        filename = options.get("filename", Path(options.get("file", "topology.clab.yml")).name)
        attrs = {"title": title, "view": view, "filename": filename, "height": str(height)}
        if "annotations" in options:
            annotations = self.read_asset(options["annotations"])
            if not isinstance(json.loads(annotations), dict):
                raise ValueError("Topology annotations must be a JSON object")
            attrs["annotations"] = annotations
        attributes = " ".join(f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items())
        # Highlight each line independently so selection can reveal the matching YAML.
        lexer, formatter = YamlLexer(), HtmlFormatter(nowrap=True)
        lines = source.rstrip("\n").split("\n")
        code = "\n".join(
            f'<span class="clab-code-line" data-line="{i}">'
            f'{highlight(line, lexer, formatter).rstrip(chr(10)) or " "}</span>'
            for i, line in enumerate(lines, 1)
        )
        return (
            f'<div class="clab-example"><clab-topology class="no-copy" {attributes}>'
            f'<pre data-clab-source hidden>{escape(source)}</pre>'
            f'<pre class="clab-source"><code>{code}</code></pre>'
            '</clab-topology></div>'
        )

    def run(self, lines):
        output, i = [], 0
        # Leave other fences (including examples of this syntax) untouched.
        outer_fence = None
        while i < len(lines):
            line = lines[i]
            fence = re.match(r"^(`{3,}|~{3,})(.*)$", line)
            if outer_fence:
                output.append(line)
                if re.fullmatch(re.escape(outer_fence[0]) + "{" + str(len(outer_fence)) + r",}\s*", line):
                    outer_fence = None
            elif fence and re.match(r"clab(?:\s|$)", fence[2]):
                options = dict(part.split("=", 1) for part in shlex.split(fence[2][4:].strip()))
                body = []
                i += 1
                while i < len(lines) and lines[i].strip() != fence[1]:
                    body.append(lines[i])
                    i += 1
                if i == len(lines):
                    raise ValueError("Unclosed clab fence")
                html = self.component(options, "\n".join(body) + "\n")
                output.extend(["", self.md.htmlStash.store(html), ""])
            else:
                output.append(line)
                if fence:
                    outer_fence = fence[1]
            i += 1
        return output


class TopologyExtension(Extension):
    def __init__(self, **kwargs):
        self.config = {"docs_dir": ["docs", "Root for topology assets"]}
        super().__init__(**kwargs)

    def extendMarkdown(self, md):
        md.preprocessors.register(TopologyPreprocessor(md, self.getConfig("docs_dir")), "clab-topology", 29)


def makeExtension(**kwargs):
    return TopologyExtension(**kwargs)
