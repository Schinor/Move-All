export interface CardKeyAttrValue {
  value: string;
  label_pt: string;
  aliases?: string[];
}

export interface CardKeyAttr {
  attr: string;
  label_pt: string;
  values: CardKeyAttrValue[];
}

export type ComparisonKind = 'number' | 'boolean' | 'enum';

export interface ComparisonAttr {
  attr: string;
  label_pt: string;
  kind: ComparisonKind;
  unit?: string;
}

export interface CatalogTypeDef {
  id: string;
  key: string;
  familyKey: string;
  familyNamePt: string;
  namePt: string;
  descriptionEn: string;
  ncm: string | null;
  cardKeyAttrs: CardKeyAttr[];
  comparisonAttrs: ComparisonAttr[];
  variationAttrs: string[];
}

export interface TaxonomySeedFile {
  families: Array<{ key: string; name_pt: string; sort: number }>;
  types: Array<{
    key: string;
    family: string;
    name_pt: string;
    ncm: string | null;
    description_en: string;
    card_key_attrs: Array<{
      attr: string;
      label_pt: string;
      values: Array<[string, string] | [string, string, string[]]>;
    }>;
    comparison_attrs: Array<
      | [string, string, ComparisonKind]
      | [string, string, ComparisonKind, string]
    >;
    variation_attrs: string[];
  }>;
}
