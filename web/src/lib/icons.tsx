/* eslint-disable react-refresh/only-export-components */
import type { ComponentType, SVGProps } from 'react'

import ArrowChevronDownIcon from '@gravity-ui/icons/esm/ArrowChevronDown.js'
import ArrowChevronRightIcon from '@gravity-ui/icons/esm/ArrowChevronRight.js'
import ArrowUpFromSquareIcon from '@gravity-ui/icons/esm/ArrowUpFromSquare.js'
import CircleXmarkIcon from '@gravity-ui/icons/esm/CircleXmark.js'
import EyeIcon from '@gravity-ui/icons/esm/Eye.js'
import EyeSlashIcon from '@gravity-ui/icons/esm/EyeSlash.js'
import FileArrowUpIcon from '@gravity-ui/icons/esm/FileArrowUp.js'
import HandIcon from '@gravity-ui/icons/esm/Hand.js'
import HandPointUpIcon from '@gravity-ui/icons/esm/HandPointUp.js'
import LayersIcon from '@gravity-ui/icons/esm/Layers.js'
import LockIcon from '@gravity-ui/icons/esm/Lock.js'
import LockOpenIcon from '@gravity-ui/icons/esm/LockOpen.js'
import MinusIcon from '@gravity-ui/icons/esm/Minus.js'
import ObjectAlignBottomIcon from '@gravity-ui/icons/esm/ObjectAlignBottom.js'
import ObjectAlignCenterHorizontalIcon from '@gravity-ui/icons/esm/ObjectAlignCenterHorizontal.js'
import ObjectAlignCenterVerticalIcon from '@gravity-ui/icons/esm/ObjectAlignCenterVertical.js'
import ObjectAlignLeftIcon from '@gravity-ui/icons/esm/ObjectAlignLeft.js'
import ObjectAlignRightIcon from '@gravity-ui/icons/esm/ObjectAlignRight.js'
import ObjectAlignTopIcon from '@gravity-ui/icons/esm/ObjectAlignTop.js'
import PictureIcon from '@gravity-ui/icons/esm/Picture.js'
import PlusIcon from '@gravity-ui/icons/esm/Plus.js'
import SquareDashedIcon from '@gravity-ui/icons/esm/SquareDashed.js'

export type AppIconComponent = ComponentType<SVGProps<SVGSVGElement>>

/** Icon representing an engraved / routed pocket in wood — outer frame + inset filled area with a top-shadow arc. */
const EngravePreviewIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" {...props}>
    {/* Wood surface border */}
    <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
    {/* Routed-out pocket */}
    <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.75" />
    {/* Shadow arc suggesting depth / inset */}
    <path d="M4.5 7 Q8 5 11.5 7" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

export const Icons = {
  alignBottom: ObjectAlignBottomIcon,
  alignCenterHorizontal: ObjectAlignCenterHorizontalIcon,
  alignCenterVertical: ObjectAlignCenterVerticalIcon,
  alignLeft: ObjectAlignLeftIcon,
  alignRight: ObjectAlignRightIcon,
  alignTop: ObjectAlignTopIcon,
  chevronDown: ArrowChevronDownIcon,
  chevronRight: ArrowChevronRightIcon,
  close: CircleXmarkIcon,
  cursor: HandPointUpIcon,
  engravePreview: EngravePreviewIcon,
  export: ArrowUpFromSquareIcon,
  eye: EyeIcon,
  eyeOff: EyeSlashIcon,
  fileUpload: FileArrowUpIcon,
  fit: SquareDashedIcon,
  hand: HandIcon,
  layers: LayersIcon,
  lock: LockIcon,
  lockOpen: LockOpenIcon,
  minus: MinusIcon,
  picture: PictureIcon,
  plus: PlusIcon,
} satisfies Record<string, AppIconComponent>

export function AppIcon({
  icon: Icon,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { icon: AppIconComponent }) {
  return <Icon className={className} {...props} />
}
