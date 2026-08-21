import 'package:flutter/material.dart';

typedef IsoAlpha2CountryCode = String;

const countryCatalogVersion = 1;

class CountryOption {
  const CountryOption(this.code, this.name)
      : assert(code.isNotEmpty),
        assert(name.isNotEmpty);

  final IsoAlpha2CountryCode code;
  final String name;
}

const countryOptions = <CountryOption>[
  CountryOption('BY', 'Belarus'),
  CountryOption('LT', 'Lithuania'),
  CountryOption('LV', 'Latvia'),
  CountryOption('PL', 'Poland'),
  CountryOption('RU', 'Russia'),
  CountryOption('UA', 'Ukraine'),
  CountryOption('DE', 'Germany'),
  CountryOption('GB', 'United Kingdom'),
  CountryOption('US', 'United States'),
];

bool countryCatalogIsValid() {
  final codes = countryOptions.map((country) => country.code).toList();
  final names = countryOptions.map((country) => country.name).toList();

  return countryOptions.isNotEmpty &&
      codes.every((code) => RegExp(r'^[A-Z]{2}$').hasMatch(code)) &&
      names.every((name) => name.trim().isNotEmpty) &&
      codes.toSet().length == codes.length;
}

String? countryNameForCode(String? code) {
  assert(countryCatalogIsValid());

  if (code == null) {
    return null;
  }

  for (final country in countryOptions) {
    if (country.code == code) {
      return country.name;
    }
  }

  return null;
}

class CountrySelectorField extends StatelessWidget {
  const CountrySelectorField({
    required this.value,
    required this.onChanged,
    required this.decoration,
    this.emptyLabel = 'Select your country',
    this.enabled = true,
    this.validator,
    super.key,
  });

  final String? value;
  final ValueChanged<String> onChanged;
  final InputDecoration decoration;
  final String emptyLabel;
  final bool enabled;
  final FormFieldValidator<String>? validator;

  Future<void> _openPicker(
    BuildContext context,
    FormFieldState<String> field,
  ) async {
    if (!enabled) {
      return;
    }

    final selectedCode = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _CountryPickerSheet(selectedCode: value),
    );

    if (selectedCode != null) {
      field.didChange(selectedCode);
      onChanged(selectedCode);
    }
  }

  @override
  Widget build(BuildContext context) {
    assert(countryCatalogIsValid());

    return FormField<String>(
      initialValue: value,
      validator: validator,
      builder: (field) {
        final selectedCountry = _findCountry(field.value);

        return Semantics(
          button: true,
          label: 'Country selector',
          value: selectedCountry?.name ?? 'No country selected',
          child: InkWell(
            onTap: enabled ? () => _openPicker(context, field) : null,
            borderRadius: BorderRadius.circular(28),
            child: InputDecorator(
              decoration: decoration.copyWith(
                errorText: field.errorText,
                suffixIcon: const Icon(Icons.keyboard_arrow_down),
              ),
              isEmpty: selectedCountry == null,
              child: Text(
                selectedCountry?.name ?? emptyLabel,
                style: TextStyle(
                  color:
                      selectedCountry == null ? Colors.black54 : Colors.black87,
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  CountryOption? _findCountry(String? code) {
    for (final country in countryOptions) {
      if (country.code == code) {
        return country;
      }
    }

    return null;
  }
}

class _CountryPickerSheet extends StatefulWidget {
  const _CountryPickerSheet({required this.selectedCode});

  final String? selectedCode;

  @override
  State<_CountryPickerSheet> createState() => _CountryPickerSheetState();
}

class _CountryPickerSheetState extends State<_CountryPickerSheet> {
  final _searchController = TextEditingController();
  var _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final countries = countryOptions.where((country) {
      return query.isEmpty ||
          country.name.toLowerCase().contains(query) ||
          country.code.toLowerCase().contains(query);
    }).toList();

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.7,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Select country',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _searchController,
                autofocus: true,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: 'Search country',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.clear),
                        ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: countries.isEmpty
                    ? const Center(child: Text('No countries found.'))
                    : ListView.builder(
                        itemCount: countries.length,
                        itemBuilder: (context, index) {
                          final country = countries[index];
                          final selected = country.code == widget.selectedCode;

                          return ListTile(
                            title: Text(country.name),
                            trailing: selected
                                ? const Icon(Icons.check)
                                : Text(country.code),
                            onTap: () =>
                                Navigator.of(context).pop(country.code),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
