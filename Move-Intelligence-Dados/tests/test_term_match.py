from app.etl.transform.term_match import normalize_term, title_matches_term


def test_normaliza_como_o_backend():
    assert normalize_term("  Step   Aeróbico, Ajustável! ") == "step aerobico ajustavel"


def test_metade_das_palavras_do_termo():
    term = "adjustable aerobic step"
    assert not title_matches_term("Adjustable Dumbbell & Weight Bench, Fitness Equipment", term)
    assert not title_matches_term("Stair Stepper for Home, Folding Stair Climber", term)
    assert title_matches_term("Fitness Equipment Adjustable Aerobic Step Stepper Pvc Material", term)
    assert title_matches_term("Aerobic Step Platform", term)


def test_plural_e_titulo_vazio():
    assert title_matches_term("NIKE Adjustable Dumbbell Set 50lb", "nike adjustable dumbbells")
    assert title_matches_term("", "nike adjustable dumbbells")
    assert title_matches_term("qualquer coisa", "gym set")  # termo só com palavras genéricas
