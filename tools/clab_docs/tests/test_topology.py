from pathlib import Path
from tempfile import TemporaryDirectory
import os
import shutil
import subprocess
import unittest

import markdown
import yaml

from clab_docs.topology import TopologyExtension


SOURCE = 'name: hello\ntopology:\n  nodes:\n    client: {kind: linux, image: "alpine:3.23"}\n'


class TopologyTests(unittest.TestCase):
    def render(self, source, directory="docs"):
        return markdown.markdown(source, extensions=[TopologyExtension(docs_dir=directory), "pymdownx.superfences"])

    def test_inline_source_is_safe_and_preserved(self):
        source = SOURCE + '# </pre><script>alert("x")</script>\n'
        html = self.render('```clab title="A & B" view="split"\n' + source + '```')
        self.assertIn('<div class="clab-example"><clab-topology', html)
        self.assertIn('title="A &amp; B"', html)
        self.assertNotIn('<script>', html)
        self.assertIn('data-line="5"', html)

    def test_external_file_and_annotations(self):
        with TemporaryDirectory() as tmp:
            Path(tmp, "lab.yml").write_text(SOURCE)
            Path(tmp, "layout.json").write_text('{"nodeAnnotations": []}')
            html = self.render('```clab file="lab.yml" annotations="layout.json"\n```', tmp)
            self.assertIn('filename="lab.yml"', html)
            self.assertIn('annotations="{&quot;nodeAnnotations&quot;: []}"', html)

    def test_documented_fences_are_not_executed(self):
        html = self.render('````markdown\n```clab\n' + SOURCE + '```\n````')
        self.assertNotIn('<clab-topology ', html)
        self.assertIn('clab', html)

    def test_bad_input_fails_the_build(self):
        for content in [
            '```clab view="bad"\n' + SOURCE + '```',
            '```clab heigth="300"\n' + SOURCE + '```',
            '```clab height="10000"\n' + SOURCE + '```',
            '```clab borderless="yes"\n' + SOURCE + '```',
            '```clab borderless="true" view="split"\n' + SOURCE + '```',
            '```clab\nname: no-topology\n```',
            '```clab\ntopology: [\n```',
            '```clab\n' + SOURCE,
            '```clab file="../package.json"\n```',
            '```clab file="missing.yml"\n```',
        ]:
            with self.subTest(content=content), self.assertRaises((ValueError, OSError, yaml.YAMLError)):
                self.render(content)

    def test_borderless_preserves_source_and_accessible_title(self):
        html = self.render('```clab borderless="true" title="Inline network"\n' + SOURCE + '```')
        self.assertIn('borderless=""', html)
        self.assertIn('title="Inline network"', html)
        self.assertIn('name: hello', html)
        self.assertIn('<pre class="clab-source">', html)
        self.assertNotIn('borderless=', self.render('```clab borderless="false"\n' + SOURCE + '```'))

    def test_multiple_components_and_normal_markdown(self):
        html = self.render('# Examples\n\n```clab\n' + SOURCE + '```\n\nSome text.\n\n```clab\n' + SOURCE + '```')
        self.assertEqual(html.count('<clab-topology '), 2)
        self.assertIn('<p>Some text.</p>', html)

    def test_zensical_rebuilds_when_a_referenced_yaml_file_changes(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            examples = root / "docs/examples"
            examples.mkdir(parents=True)
            (root / "zensical.toml").write_text(
                '[project]\nsite_name="Test"\nwatch=["docs/examples"]\n'
                '[project.markdown_extensions]\n"clab_docs.topology" = {}\n'
            )
            (root / "docs/index.md").write_text('# Test\n\n```clab file="examples/lab.yml"\n```\n')
            source = examples / "lab.yml"
            source.write_text(SOURCE)
            command = [shutil.which("zensical"), "build", "--strict"]
            subprocess.run(command, cwd=root, check=True, capture_output=True)
            self.assertIn('name: hello', (root / "site/index.html").read_text())
            source.write_text(SOURCE.replace("hello", "changed"))
            os.utime(source, (source.stat().st_atime, source.stat().st_mtime + 2))
            subprocess.run(command, cwd=root, check=True, capture_output=True)
            self.assertIn('name: changed', (root / "site/index.html").read_text())


if __name__ == "__main__":
    unittest.main()
