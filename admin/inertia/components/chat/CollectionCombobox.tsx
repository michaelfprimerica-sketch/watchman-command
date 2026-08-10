import { useId } from 'react'
import { mergeCollectionOptions } from '~/lib/knowledge_collections'

interface CollectionComboboxProps {
  value: string
  onChange: (value: string) => void
  collections: readonly string[]
  label: string
  disabled?: boolean
  placeholder?: string
  className?: string
}

/**
 * Native editable combobox: keyboard and assistive-technology behavior come
 * from the platform, while a datalist permits creation by typing a new label.
 */
export default function CollectionCombobox({
  value,
  onChange,
  collections,
  label,
  disabled = false,
  placeholder = 'Uncategorized',
  className = '',
}: CollectionComboboxProps) {
  const inputId = useId()
  const listId = useId()
  const helpId = useId()
  const options = mergeCollectionOptions(collections, value)

  return (
    <div className={className}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-describedby={helpId}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-md border border-border-default bg-surface-primary px-3 py-2 text-sm text-text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-desert-green disabled:opacity-50"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <span id={helpId} className="sr-only">
        Choose an existing collection or type a new name, up to 64 characters.
      </span>
    </div>
  )
}
