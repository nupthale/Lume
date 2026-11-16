export enum PopoverTypeEnum {
  MENTION = "mention",
  EMOJI = "emoji",
  BUBBLE_MENU = 'bubble-menu',
  LINK = 'link',
  FLOAT_MENU = 'float-menu',
  AUTO_COMPLETE = 'auto-complete',
  MENUS = 'mentionMenus',
  BRANCH = "mentionBranch",
  INDEX = 'mentionIndex',
  INDEXGROUP = 'mentionIndexGroup',
}

export enum CommandEnum {
  STRONG = 'string',
  ITALIC = 'italic',
  UNDERLINE = 'underline',
  STRIKE = 'strike',
  PALETTE = 'palette',
  CODE = 'code',
  LINK = 'link',
  HIGHLIGHT_PALETTE = 'highlight_palette',
  HIGHLIGHT_SMALL = 'highlight_small',
  TABLE_DELETEROW = 'table_deleteRow',
  TABLE_DELETECOL = 'table_deleteCol',
  TABLE_MERGECELL = 'table_mergeCell',
  TABLE_CELLBGCOLOR = 'table_cellBgColor',
  COLUMNS_DELETECOL = 'columns_deleteCol',
  COLUMNS_COLUMNBGCOLOR = 'columns_columnBgColor',
}

export enum MentionTypeEnum {
  MENUS = 'mentionMenus',
  USER = "user",
  BRANCH = "mentionBranch",
  INDEX = 'mentionIndex',
  INDEXGROUP = 'mentionIndexGroup',
}

export type MentionParam = {
  type: MentionTypeEnum;
  name: string;
  id: string;
}

export interface UserType {
  name: string;
  id: string;
}

export enum NodeViewEnum {
  HEADER = 'header',
  DIVIDER = 'divider',
  HIGHLIGHT = 'highlight',
  LIST = 'list',
  LIST_HEAD = 'list_head',
  LIST_BODY = 'list_body',
  MENTION = 'mention',
  TABLE = 'table',
  TEXT_BLOCK = 'textBlock',
  TEXT_BLOCK_HEAD = 'textBlock_head',
  TEXT_BLOCK_BODY = 'textBlock_body',
  TITLE = 'title',
  IMAGE = 'image',
  VIDEO = 'video',
  CODER = 'coder',
  COLUMNS = 'columns',
  QUOTE = 'quote',
  QUERY = 'query',
}

export enum ConvertNodeTypeEnum {
  TEXT_BLOCK = 'textBlock',
  BULLET_LIST = 'bulletList',
  ORDERED_LIST = 'orderedList',
  TODO_LIST = 'todoList',
  TOGGLE_LIST = 'toggleList',
  CODER = 'coder',
  H1 = 'h1',
  H2 = 'h2',
  H3 = 'h3',
  H4 = 'h4',
  H5 = 'h5',
  H6 = 'h6',
  QUOTE = 'quote',
  HIGHLIGHT = 'highlight',
}