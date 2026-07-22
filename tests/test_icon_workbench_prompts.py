import unittest

from file_pilot.icon_workbench.prompts import (
    DEFAULT_FALLBACK_SUBJECT,
    DEFAULT_STYLE_PHRASE,
    ICON_CONSTRAINTS,
    build_default_icon_prompt,
    compose_icon_prompt,
)
from file_pilot.icon_workbench.templates import builtin_templates, render_prompt_template


class IconWorkbenchPromptCompositionTests(unittest.TestCase):
    def test_default_prompt_is_subject_first_with_shared_parts(self):
        subject = "a musical note and headphones"
        prompt = build_default_icon_prompt(subject)

        self.assertTrue(prompt.startswith(subject))
        self.assertIn(DEFAULT_STYLE_PHRASE, prompt)
        self.assertIn(ICON_CONSTRAINTS, prompt)
        self.assertIn("2d flat icon design", prompt)
        self.assertIn("solid white background", prompt)

    def test_empty_subject_uses_neutral_fallback(self):
        prompt = build_default_icon_prompt("  ")
        self.assertTrue(prompt.startswith(DEFAULT_FALLBACK_SUBJECT))

    def test_compose_icon_prompt_accepts_custom_style(self):
        subject = "a crab and a gear"
        style = "pixel art style, sharp pixels, vibrant palette"
        prompt = compose_icon_prompt(subject, style)

        self.assertEqual(
            prompt,
            f"{subject}, {style}, {ICON_CONSTRAINTS}",
        )

    def test_render_template_injects_subject_and_appends_constraints(self):
        rendered = render_prompt_template(
            "{{subject}}, cute 3D claymorphism style, soft pastel colors",
            folder_name="RustTools",
            category="项目源码",
            subject="a crab and a gear",
        )
        self.assertTrue(rendered.startswith("a crab and a gear"))
        self.assertIn("cute 3D claymorphism style", rendered)
        self.assertTrue(rendered.endswith(ICON_CONSTRAINTS))

    def test_empty_template_falls_back_to_default_composition(self):
        rendered = render_prompt_template(
            "",
            folder_name="Alpha",
            category="未分类",
            subject="a calculator and a checkmark",
        )
        self.assertEqual(rendered, build_default_icon_prompt("a calculator and a checkmark"))

    def test_builtin_templates_are_subject_slots_plus_style(self):
        templates = builtin_templates()
        self.assertGreaterEqual(len(templates), 1)
        for template in templates:
            self.assertTrue(
                template.prompt_template.startswith("{{subject}},"),
                msg=template.template_id,
            )
            # Style phrase only; constraints are appended at render time.
            self.assertNotIn(ICON_CONSTRAINTS, template.prompt_template)


if __name__ == "__main__":
    unittest.main()
