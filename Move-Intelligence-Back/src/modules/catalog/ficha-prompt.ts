import { FICHA_PROMPT_VERSION } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface FichaPromptItem {
  ref: string;
  text: string;
}

function typeLine(t: CatalogTypeDef): string {
  const key = t.cardKeyAttrs.length
    ? t.cardKeyAttrs.map((a) => `${a.attr} ∈ {${a.values.map((v) => v.value).join(', ')}}`).join('; ')
    : '(none)';
  const cmp = t.comparisonAttrs.length
    ? t.comparisonAttrs.map((c) => `${c.attr} (${c.kind}${c.unit ? `, ${c.unit}` : ''})`).join(', ')
    : '(none)';
  const variation = t.variationAttrs.length ? t.variationAttrs.join(', ') : '(none)';
  return `- ${t.key}: ${t.descriptionEn} | card key: ${key} | comparison: ${cmp} | variation: ${variation}`;
}

export function buildFichaSystemPrompt(types: CatalogTypeDef[]): string {
  return [
    `You are a strict product classifier for a fitness-equipment sourcing catalog (prompt ${FICHA_PROMPT_VERSION}).`,
    'Each input is a marketplace listing (title, sometimes followed by structured data, specs and bullets) in Portuguese,',
    'English, Simplified or Traditional Chinese. Listings may be noisy, SEO-stuffed, off-topic, accessories, kits or have variations.',
    '',
    'CLOSED TYPE LIST (type_key must be exactly one of these keys, or "unknown"):',
    ...types.map(typeLine),
    '',
    'RULES:',
    '1. Classify by the MAIN physical object being sold, not by words that merely appear in the title (titles add related keywords, e.g. 哑铃/啞鈴 "dumbbell" inside kettlebell or plate listings).',
    '2. A part/accessory FOR a machine: is_accessory_or_part=true and use the type of the part itself when it exists (e.g. dumbbell_handle); if no type describes the part, type_key="unknown".',
    '3. Not fitness equipment (bags, waist packs, phone armbands, clothes, shoes, headphones, speakers, supplements, toys): in_scope=false.',
    '4. Fitness item but no type fits: type_key="unknown" and suggested_type in snake_case English.',
    '5. Kits with different products: is_kit_or_bundle=true; classify by the main item. A pair or a set of the same item is NOT a kit.',
    '6. card_key_values: only the allowed values listed for the type. If the listing has a distinguishing feature not in the list (e.g. a treadmill with a shower), put it in new_differential. If a value is not stated, omit the attribute.',
    '7. comparison_values, variation_values and specs: only facts present in the text, values in English, original units. Never invent.',
    '8. Never invent a new type_key.',
    '',
    'EXAMPLES:',
    '- "Esteira Elétrica Plana Residencial Bluetooth" -> type_key "walking_pad"',
    '- "Barra Halter 35cm Cromada com Rosca" -> type_key "dumbbell_handle", is_accessory_or_part true',
    '- "Keep跑步腰包运动手机袋" (running waist bag) -> in_scope false',
    '- "呼吸啞鈴腹式呼吸訓練器" (breathing trainer) -> in_scope false',
    '- "实心竞技壶铃…提壶哑铃" -> type_key "kettlebell"',
    '- "大孔健身啞鈴片 槓鈴片 15kg" -> type_key "weight_plate"',
    '- "Power Rack Barra Fixa Supino Agachamento" -> type_key "power_rack"',
    '- "Treadmill with shower head for home" -> type_key "treadmill", new_differential "shower"',
    '',
    'OUTPUT: JSON Lines only — one JSON object per line, one line per input, no code fences, no text before or after.',
    'Keys of each object:',
    '{"ref": str, "type_key": str, "suggested_type": str|null, "in_scope": bool, "is_accessory_or_part": bool,',
    ' "is_kit_or_bundle": bool, "has_variations": bool, "card_key_values": {attr: value}, "new_differential": str|null,',
    ' "comparison_values": {attr: value}, "variation_values": {attr: value}, "specs": {name: value}, "brand": str|null,',
    ' "model": str|null, "confidence": number 0-1}',
  ].join('\n');
}

export function buildFichaUserMessage(items: FichaPromptItem[]): string {
  return JSON.stringify(items.map((item) => ({ ref: item.ref, text: item.text })));
}
